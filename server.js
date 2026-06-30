const express = require("express");
const session = require("express-session");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const PORT = process.env.PORT || 3000;
const db = new sqlite3.Database("/var/data/database.db");

const server = http.createServer(app);
const io = new Server(server);
const bcrypt = require("bcryptjs");

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: "pleroma_secret_key",
    resave: false,
    saveUninitialized: false,
  })
);

app.use(express.static(path.join(__dirname, "public")));

function requireLogin(req, res, next) {
  if (!req.session.user) return res.status(401).send("Not logged in");
  next();
}

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fullName TEXT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE,
      password TEXT NOT NULL
    )
  `);

  db.run("ALTER TABLE users ADD COLUMN fullName TEXT", () => {});
  db.run("ALTER TABLE users ADD COLUMN email TEXT", () => {});

  db.run(`
    CREATE TABLE IF NOT EXISTS profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER UNIQUE,
      bio TEXT DEFAULT '',
      favouriteSport TEXT DEFAULT ''
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sport TEXT NOT NULL,
      location TEXT NOT NULL,
      time TEXT NOT NULL,
      maxPlayers INTEGER NOT NULL,
      latitude REAL,
      longitude REAL,
      creatorId INTEGER
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS join_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      activityId INTEGER,
      userId INTEGER,
      status TEXT DEFAULT 'pending'
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS participants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      activityId INTEGER,
      userId INTEGER,
      UNIQUE(activityId, userId)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      senderId INTEGER,
      receiverId INTEGER,
      message TEXT NOT NULL,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.post("/register", async (req, res) => {
  const { fullName, username, email, favouriteSport, bio, password, confirmPassword } = req.body;

  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;

  if (!fullName || !username || !email || !password || !confirmPassword) {
    return res.send("Please complete all required fields.");
  }

  if (password !== confirmPassword) {
    return res.send("Passwords do not match.");
  }

  if (!passwordRegex.test(password)) {
    return res.send(
      "Password must be at least 8 characters and include uppercase, lowercase, and a number."
    );
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  db.run(
    "INSERT INTO users (fullName, username, email, password) VALUES (?, ?, ?, ?)",
    [fullName, username, email, hashedPassword],
    function (err) {
      if (err) return res.send("Username or email already exists.");

      db.run(
        "INSERT INTO profiles (userId, bio, favouriteSport) VALUES (?, ?, ?)",
        [this.lastID, bio || "", favouriteSport || ""],
        () => res.redirect("/")
      );
    }
  );
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;

  db.get(
    "SELECT * FROM users WHERE username = ? OR email = ?",
    [username, username],
    async (err, user) => {
      if (!user) return res.send("Invalid login details");

      let isMatch = false;

      if (user.password.startsWith("$2")) {
        isMatch = await bcrypt.compare(password, user.password);
      } else {
        isMatch = password === user.password;
        if (isMatch) {
          const hashed = await bcrypt.hash(password, 10);
          db.run("UPDATE users SET password = ? WHERE id = ?", [hashed, user.id]);
        }
      }

      if (!isMatch) return res.send("Invalid login details");

      req.session.user = user;
      res.redirect("/dashboard.html");
    }
  );
});

app.get("/api/current-user", requireLogin, (req, res) => {
  res.json({
    id: req.session.user.id,
    username: req.session.user.username,
  });
});

app.get("/api/profile", requireLogin, (req, res) => {
  const userId = req.session.user.id;

  db.get(
    `
    SELECT users.username, users.fullName, users.email, profiles.bio, profiles.favouriteSport
    FROM users
    LEFT JOIN profiles ON users.id = profiles.userId
    WHERE users.id = ?
    `,
    [userId],
    (err, profile) => {
      if (err) return res.status(500).send("Error loading profile");

      db.get(
        "SELECT COUNT(*) AS createdCount FROM activities WHERE creatorId = ?",
        [userId],
        (err, created) => {
          db.get(
            "SELECT COUNT(*) AS joinedCount FROM participants WHERE userId = ?",
            [userId],
            (err, joined) => {
              res.json({
                username: profile.username,
                fullName: profile.fullName || "",
                email: profile.email || "",
                bio: profile.bio || "",
                favouriteSport: profile.favouriteSport || "",
                createdCount: created.createdCount,
                joinedCount: joined.joinedCount,
              });
            }
          );
        }
      );
    }
  );
});

app.post("/api/profile", requireLogin, (req, res) => {
  const { bio, favouriteSport } = req.body;
  const userId = req.session.user.id;

  db.run(
    `
    INSERT INTO profiles (userId, bio, favouriteSport)
    VALUES (?, ?, ?)
    ON CONFLICT(userId)
    DO UPDATE SET bio = excluded.bio, favouriteSport = excluded.favouriteSport
    `,
    [userId, bio, favouriteSport],
    function (err) {
      if (err) return res.status(500).send("Error saving profile: " + err.message);
      res.send("Profile saved successfully");
    }
  );
});

app.get("/api/activities", requireLogin, (req, res) => {
  db.all(
    `
    SELECT 
      activities.*,
      users.username AS creatorName,
      COUNT(participants.id) AS joinedCount
    FROM activities
    JOIN users ON activities.creatorId = users.id
    LEFT JOIN participants ON activities.id = participants.activityId
    GROUP BY activities.id
    ORDER BY activities.time ASC
    `,
    [],
    (err, rows) => {
      if (err) return res.status(500).send("Error loading activities: " + err.message);

      const activities = rows.map((activity) => ({
        ...activity,
        isOwner: activity.creatorId === req.session.user.id,
        isFull: activity.joinedCount >= activity.maxPlayers,
      }));

      res.json(activities);
    }
  );
});

app.post("/api/activities", requireLogin, (req, res) => {
  const { sport, location, time, maxPlayers, latitude, longitude } = req.body;

  if (!sport || !location || !time || !maxPlayers || !latitude || !longitude) {
    return res.send("Error creating activity: missing required fields");
  }

  db.run(
    `INSERT INTO activities 
    (sport, location, time, maxPlayers, latitude, longitude, creatorId) 
    VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      sport,
      location,
      time,
      Number(maxPlayers),
      Number(latitude),
      Number(longitude),
      req.session.user.id,
    ],
    function (err) {
      if (err) return res.send("Error creating activity: " + err.message);

      db.run(
        "INSERT OR IGNORE INTO participants (activityId, userId) VALUES (?, ?)",
        [this.lastID, req.session.user.id]
      );

      res.send("Activity created");
    }
  );
});

app.put("/api/activities/:id", requireLogin, (req, res) => {
  const activityId = req.params.id;
  const { sport, location, time, maxPlayers } = req.body;

  db.get(
    "SELECT * FROM activities WHERE id = ? AND creatorId = ?",
    [activityId, req.session.user.id],
    (err, activity) => {
      if (err || !activity) {
        return res.status(403).send("You can only edit your own activities");
      }

      db.run(
        `
        UPDATE activities
        SET sport = ?, location = ?, time = ?, maxPlayers = ?
        WHERE id = ? AND creatorId = ?
        `,
        [sport, location, time, Number(maxPlayers), activityId, req.session.user.id],
        function (err) {
          if (err) return res.status(500).send("Error updating activity: " + err.message);
          res.send("Activity updated successfully");
        }
      );
    }
  );
});

app.delete("/api/activities/:id", requireLogin, (req, res) => {
  const activityId = req.params.id;

  db.get(
    "SELECT * FROM activities WHERE id = ? AND creatorId = ?",
    [activityId, req.session.user.id],
    (err, activity) => {
      if (err || !activity) {
        return res.status(403).send("You can only delete your own activities");
      }

      db.run("DELETE FROM join_requests WHERE activityId = ?", [activityId], () => {
        db.run("DELETE FROM participants WHERE activityId = ?", [activityId], () => {
          db.run(
            "DELETE FROM activities WHERE id = ? AND creatorId = ?",
            [activityId, req.session.user.id],
            function (err) {
              if (err) return res.status(500).send("Error deleting activity: " + err.message);
              res.send("Activity deleted successfully");
            }
          );
        });
      });
    }
  );
});

app.post("/api/request/:activityId", requireLogin, (req, res) => {
  const activityId = req.params.activityId;
  const userId = req.session.user.id;

  db.get("SELECT * FROM activities WHERE id = ?", [activityId], (err, activity) => {
    if (!activity) return res.status(404).send("Activity not found");

    if (activity.creatorId === userId) {
      return res.status(400).send("You cannot join your own activity");
    }

    db.get(
      "SELECT COUNT(*) AS joinedCount FROM participants WHERE activityId = ?",
      [activityId],
      (err, countRow) => {
        if (countRow.joinedCount >= activity.maxPlayers) {
          return res.status(400).send("This activity is already full");
        }

        db.get(
          "SELECT * FROM participants WHERE activityId = ? AND userId = ?",
          [activityId, userId],
          (err, participant) => {
            if (participant) {
              return res.status(400).send("You are already joined in this activity");
            }

            db.get(
              "SELECT * FROM join_requests WHERE activityId = ? AND userId = ? AND status = 'pending'",
              [activityId, userId],
              (err, existingRequest) => {
                if (existingRequest) {
                  return res.status(400).send("You already have a pending request");
                }

                db.run(
                  "INSERT INTO join_requests (activityId, userId) VALUES (?, ?)",
                  [activityId, userId],
                  function (err) {
                    if (err) return res.send("Error sending request: " + err.message);
                    res.send("Join request sent");
                  }
                );
              }
            );
          }
        );
      }
    );
  });
});

app.get("/api/requests", requireLogin, (req, res) => {
  db.all(
    `
    SELECT 
      join_requests.id,
      join_requests.status,
      join_requests.activityId,
      join_requests.userId,
      activities.sport,
      activities.location,
      activities.time,
      activities.maxPlayers,
      users.username
    FROM join_requests
    JOIN activities ON join_requests.activityId = activities.id
    JOIN users ON join_requests.userId = users.id
    WHERE activities.creatorId = ?
    `,
    [req.session.user.id],
    (err, rows) => {
      if (err) return res.status(500).send("Error loading requests: " + err.message);
      res.json(rows);
    }
  );
});

app.post("/api/requests/:id/:status", requireLogin, (req, res) => {
  const requestId = req.params.id;
  const status = req.params.status;

  if (status !== "approved" && status !== "rejected") {
    return res.status(400).send("Invalid status");
  }

  db.get(
    `
    SELECT join_requests.*, activities.maxPlayers
    FROM join_requests
    JOIN activities ON join_requests.activityId = activities.id
    WHERE join_requests.id = ?
    `,
    [requestId],
    (err, request) => {
      if (!request) return res.status(404).send("Request not found");

      if (status === "rejected") {
        db.run(
          "UPDATE join_requests SET status = ? WHERE id = ?",
          [status, requestId],
          function (err) {
            if (err) return res.send("Error updating request: " + err.message);
            res.send("Request rejected");
          }
        );
        return;
      }

      db.get(
        "SELECT COUNT(*) AS joinedCount FROM participants WHERE activityId = ?",
        [request.activityId],
        (err, countRow) => {
          if (countRow.joinedCount >= request.maxPlayers) {
            return res.status(400).send("Cannot approve. Activity is already full");
          }

          db.run(
            "INSERT OR IGNORE INTO participants (activityId, userId) VALUES (?, ?)",
            [request.activityId, request.userId],
            (err) => {
              if (err) return res.send("Error adding participant: " + err.message);

              db.run(
                "UPDATE join_requests SET status = 'approved' WHERE id = ?",
                [requestId],
                function (err) {
                  if (err) return res.send("Error updating request: " + err.message);
                  res.send("Request approved and participant added");
                }
              );
            }
          );
        }
      );
    }
  );
});

app.get("/api/users", requireLogin, (req, res) => {
  const currentUserId = req.session.user.id;

  db.all(
    `
    SELECT DISTINCT users.id, users.username
    FROM users
    JOIN participants p1 ON users.id = p1.userId
    JOIN participants p2 ON p1.activityId = p2.activityId
    WHERE p2.userId = ?
    AND users.id != ?
    `,
    [currentUserId, currentUserId],
    (err, rows) => {
      if (err) return res.status(500).send("Error loading connected users: " + err.message);
      res.json(rows);
    }
  );
});

app.get("/api/messages/:userId", requireLogin, (req, res) => {
  const otherUserId = req.params.userId;

  db.all(
    `
    SELECT messages.*, sender.username AS senderName
    FROM messages
    JOIN users sender ON messages.senderId = sender.id
    WHERE 
      (senderId = ? AND receiverId = ?)
      OR
      (senderId = ? AND receiverId = ?)
    ORDER BY createdAt ASC
    `,
    [req.session.user.id, otherUserId, otherUserId, req.session.user.id],
    (err, rows) => {
      if (err) return res.status(500).send("Error loading messages: " + err.message);
      res.json(rows);
    }
  );
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

io.on("connection", (socket) => {
  socket.on("joinChat", (userId) => {
    socket.join(`user_${userId}`);
  });

  socket.on("sendMessage", (data) => {
    const { senderId, receiverId, message, senderName } = data;

    db.get(
      `
      SELECT p1.activityId
      FROM participants p1
      JOIN participants p2 ON p1.activityId = p2.activityId
      WHERE p1.userId = ?
      AND p2.userId = ?
      LIMIT 1
      `,
      [senderId, receiverId],
      (err, connection) => {
        if (err || !connection) {
          socket.emit(
            "messageError",
            "You can only message users from approved shared activities."
          );
          return;
        }

        db.run(
          "INSERT INTO messages (senderId, receiverId, message) VALUES (?, ?, ?)",
          [senderId, receiverId, message],
          function (err) {
            if (err) return;

            const newMessage = {
              id: this.lastID,
              senderId,
              receiverId,
              message,
              senderName,
              createdAt: new Date().toISOString(),
            };

            io.to(`user_${receiverId}`).emit("newMessage", newMessage);
            io.to(`user_${senderId}`).emit("newMessage", newMessage);
          }
        );
      }
    );
  });
});

server.listen(PORT, () => {
  console.log(`PLEROMA running at http://localhost:${PORT}`);
});