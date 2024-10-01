// routes/webclient.js
const express = require("express");
const router = express.Router();
const auth = require("../auth.js");
const path = require("path");
const fs = require("fs");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("@ffmpeg-installer/ffmpeg").path;
ffmpeg.setFfmpegPath(ffmpegPath);

// A plain GET will give the login page
router.get("/login", (req, res) => {
    res.sendFile(path.join(__dirname, "../public/login.html"));
});

// POST for getting the cookie
router.post("/login", (req, res) => {
    // Check the username and password
    console.log(req.body);
    const {username, password} = req.body;
    const token = auth.generateAccessToken(username, password);

    if (!token) {
        console.log("Unsuccessful login by user", username);
        return res.sendStatus(403);
    }

    console.log("Successful login by user", username);

    // Store the token in a cookie so that later requests will have it
    res.cookie("token", token, {
        httpOnly: true,
        sameSite: "Strict",
    });

    // Web client gets redirected to / after successful login
    res.redirect("/");
});

// Log out by deleting token cookie.  Redirect back to login.
router.get("/logout", auth.authenticateCookie, (req, res) => {
    console.log("Logout by user", req.user.username);
    res.clearCookie("token");
    res.redirect("/login");
});

router.post("/upload", auth.authenticateCookie, (req, res) => {
    const file = req.files.uploadFile;
    const username = req.user.username;
    const newFilename = `${username}-${file.name}`;
    const uploadPath = path.join(__dirname, "../uploads", newFilename);

    file.mv(uploadPath, (err) => {
        if (err) {
            return res.status(500).send(err.message);
        }

        console.log("File moved to: ", uploadPath);

        // Check if the file is a video
        const videoExtensions = [".mp4", ".avi", ".mov", ".mkv"];
        const fileExtension = path.extname(file.name).toLowerCase();

        if (videoExtensions.includes(fileExtension)) {
            // Transcoding
            const outputFilename = `${username}-${path.parse(file.name).name}.mkv`;
            const outputPath = path.join(__dirname, "../uploads", outputFilename);

            console.log("Output path: ", outputPath);

            try {
                ffmpeg(uploadPath)
                    .outputOptions("-c:v libx265")
                    .output(outputPath)
                    .on("start", (commandLine) => {
                        console.log("Spawned ffmpeg with command: " + commandLine);
                    })
                    .on("progress", (progress) => {
                        console.log("Processing: " + progress.percent + "% done");
                    })
                    .on("end", () => {
                        console.log("Transcoding succeeded!");
                        res.sendFile(path.join(__dirname, "../public/upload.html"));
                    })
                    .on("error", (err) => {
                        console.error("Transcoding failed: ", err.message);
                        res.status(500).send("Transcoding failed: " + err.message);
                    })
                    .run();
            } catch (err) {
                console.error("ffmpeg execution error: ", err.message);
                res.status(500).send("ffmpeg execution error: " + err.message);
            }
        } else {
            // Not a video, just move the file
            res.sendFile(path.join(__dirname, "../public/upload.html"));
        }
    });
});


router.get("/uploads", auth.authenticateCookie, (req, res) => {
    const uploadDir = path.join(__dirname, "../uploads");
    const username = req.user.username;
    const isAdmin = username === "admin";

    fs.readdir(uploadDir, (err, files) => {
        if (err) {
            return res.status(500).json({ error: "Unable to read upload directory" });
        }

        const userFiles = isAdmin ? files : files.filter(file => file.startsWith(`${username}-`));
        const filesWithDates = userFiles.map(file => {
            const fileStats = fs.statSync(path.join(uploadDir, file));
            const uploadDate = fileStats.mtime.toISOString().split('T')[0]; // Get the last modified date
            return { name: file, uploadDate };
        });

        res.json({ files: filesWithDates, isAdmin });
    });
});

// Serve up static files if they exist in public directory, protected by authentication middleware
router.use("/", auth.authenticateCookie, express.static(path.join(__dirname, "../public")));

module.exports = router;