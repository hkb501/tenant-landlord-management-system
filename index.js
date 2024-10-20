import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import env from "dotenv";
import passport from "passport"; // Make sure passport is imported
import session from "express-session"; // Required for managing sessions
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import nodemailer from "nodemailer";

const app = express();
const port = 3000;
env.config(); // Can access to variables via process.env

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
app.set("view engine", "ejs");
app.set("views", "./views");

// Ensure session is set up before passport initialization
app.use(
  session({
    secret: process.env.PG_PASSWORD,
    resave: false,
    saveUninitialized: true,
  })
);

// Initialize passport
app.use(passport.initialize());
app.use(passport.session());

// PostgreSQL setup
const db = new pg.Client({
  user: process.env.PG_USER,
  host: process.env.PG_HOST,
  database: process.env.PG_DATABASE,
  password: process.env.PG_PASSWORD,
  port: process.env.PG_PORT,
});
db.connect();

// Find the logged in user or create one
async function findOrCreateUser(profile) {
  // Getting user's info from google
  const googleId = profile.id;
  const email = profile.emails[0].value;
  const name = profile.displayName;
  //Check if the user already exist
  const query = "SELECT * FROM users WHERE google_id = $1 OR email = $2";
  const existingUser = await db.query(query, [googleId, email]);
  if (existingUser.rows.length > 0) {
    // User already exists
    return existingUser.rows[0];
  }

  // User doesn't exist in data base
  // Creating a user

  const insertQuery =
    "INSERT INTO users (google_id, name,email,role) VALUES ($1,$2,$3,$4) RETURNING * ";
  const newUserRole = "tenant";
  const newUser = await db.query(insertQuery, [
    googleId,
    name,
    email,
    newUserRole,
  ]);
  return newUser.rows[0];
}
// Google OAuth strategy
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: "http://localhost:3000/auth/google/callback",
      userProfileURL: "https://www.googleapis.com/oauth2/v3/userinfo",
    },
    async (accessToken, refreshToken, profile, cb) => {
      try {
        const user = await findOrCreateUser(profile);
        cb(null, user);
      } catch (err) {
        console.log(err);
      }
    }
  )
);

// Serialize and deserialize user for session management
passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  const userQuery = "SELECT * FROM users WHERE id = $1";
  const user = await db.query(userQuery, [id]);
  done(null, user.rows[0]);
});
// Routes
app.get(
  "/auth/google/callback",
  passport.authenticate("google", { failureRedirect: "/resident-login" }),
  async (req, res) => {
    try {
      const userId = req.user.id;
      const user = await db.query("SELECT role FROM users WHERE id = $1 ", [
        userId,
      ]);
      const userRole = user.rows[0].role;
      if (userRole == "tenant") {
        res.render("tenant-dashboard");
      } else {
        res.render("/landlord-dashboard");
      }
    } catch (err) {
      console.error(err);
      res.redirect("/resident-login");
    }
  }
);

app.get("/", (req, res) => {
  res.render("home", { title: "home", cssFile: "styles.css" });
});

app.get("/login", (req, res) => {
  res.render("login", { title: "login" });
});

app.get("/landlord-login", (req, res) => {
  res.render("landlord-login", { title: "landlord login" });
});

app.get("/resident-login", (req, res) => {
  res.render("resident-login", {
    title: "resident login",
    cssFile: "style-login.css",
  });
});

app.get("/resident-forgotpassword", (req, res) => {
  res.render("resident-forgotpassword", { title: "resident forgot password" });
});

app.get("/landlord-forgotpassword", (req, res) => {
  res.render("landlord-forgotpassword", { title: "landlord forgot password" });
});

app.get("/rental-application", (req, res) => {
  res.render("rental-application", { title: "Application for rental" });
});

app.get(
  "/auth/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
  })
);
// Fetch properties for the front end
app.get("/properties", async (req, res) => {
  try {
    const properties = await db.query(`SELECT * FROM properties LIMIT 6`);
    // console.log(properties.rows);
    res.json(properties.rows); // Return the data in JSON format
  } catch (err) {
    console.error("Server error:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

// Contact us form handler
app.post("/send-email", (req, res) => {
  const { name, email, subject, category, message } = req.body;
  // Create a transporter for sending emails
  const transporter = nodemailer.createTransport({
    service: "Gmail",
    auth: {
      user: process.env.CONTACT_US_EMAIL,
      pass: process.env.CONTACT_US_PASSWORD,
    },
  });
  const mailOptions = {
    from: email,
    to: process.env.CONTACT_US_EMAIL,
    subject: `New Contact Form Submission:${category} - ${subject}`,
    text: `You have a new contact form submission: Name: ${name}
            Email: ${email}
            Subject: ${subject}
            Category: ${category}
            Message: ${message}`,
  };
  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.log(error);
      res.status(500).send("Error sending email");
    } else {
      console.log("Email sent: " + info.response);
      return res.redirect("/?success=true");
    }
  });
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
