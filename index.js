import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import env from "dotenv";
import passport from "passport"; // Make sure passport is imported
import session from "express-session"; // Required for managing sessions
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import nodemailer from "nodemailer";
import axios from "axios";

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
  try {
    const userQuery = "SELECT * FROM users WHERE id = $1";
    const user = await db.query(userQuery, [id]);
    done(null, user.rows[0]); // Attach user object to req.user
  } catch (err) {
    done(err, null);
  }
});
// Routes
app.get(
  "/auth/google/callback",
  passport.authenticate("google", { failureRedirect: "/resident-login" }),
  async (req, res) => {
    if (req.user.role === "tenant") {
      res.redirect("/tenant-dashboard"); // Redirect to the tenant dashboard route
    } else {
      res.redirect("/landlord-dashboard"); // Redirect to landlord dashboard if the user is a landlord
    }
  }
);

// Dashboard of the tenant info
app.get("/tenant-dashboard", async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect("/resident-login");
  }

  try {
    const userId = req.user.id;
    const userResult = await db.query(
      "SELECT name, email, role, created_at FROM users WHERE id = $1",
      [userId]
    );
    const user = userResult.rows[0];

    // Fetch messages from the mailbox
    const mailbox = await db.query(
      "SELECT * FROM mailbox WHERE sender_id = $1 OR receiver_id = $1 ORDER BY sent_at DESC",
      [userId]
    );

    // Fetch payment history from the external API
    const paymentResponse = await axios.get(
      "http://localhost:5100/api/v1/payment/card"
    );
    let payments = paymentResponse.data.success
      ? paymentResponse.data.data.data
      : [];

    // Add payment_date to each payment record
    payments = payments.map((payment) => ({
      ...payment,
      payment_date: new Date().toLocaleDateString(), // Or use a specific date if needed
    }));

    res.render("tenant-dashboard", {
      title: "Tenant Dashboard",
      cssFile: "tenant-dashboard.css",
      user: user,
      payments: payments,
      mailbox: mailbox.rows,
    });
  } catch (err) {
    console.error(err);
    res.redirect("/resident-login");
  }
});

// Manage tenant dashboard information
app.get("/tenant-dashboard/profile", async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect("/resident-login");
  }
  const userId = req.user.id;

  // fetch the user information from the users table
  const userQuery =
    "SELECT name, email, role, created_at FROM users WHERE id = $1";
  const userResult = await db.query(userQuery, [userId]);
  const userInfo = userResult.rows[0]; // Get the first row of the result

  res.render("profile", {
    title: "User Profile",
    cssFile: "profile.css",
    userInfo: userInfo, // Pass the userInfo object directly
  });
});

// Inserting new information
app.post("/tenant-dashboard/profile/update", async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect("/resident-login");
  }

  const { name, role } = req.body;
  const userId = req.user.id;

  try {
    const updateQuery = `
      UPDATE users 
      SET name = $1, role = $2
      WHERE id = $3
      RETURNING *;
    `;
    const result = await db.query(updateQuery, [name, role, userId]);
    req.user = result.rows[0]; // Update session user data

    res.redirect("/tenant-dashboard");
  } catch (error) {
    console.error("Error updating profile:", error);
    res.status(500).send("Server error");
  }
});

// Mail box

app.get("/tenant-dashboard/mailbox", async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect("/resident-login");
  }

  const userId = req.user.id;

  // Fetch messages where the tenant is either sender or receiver
  const mailboxQuery = `
      SELECT m.sender_id, m.receiver_id, m.subject, m.message_content, m.sent_at, u.email AS sender_email 
        FROM mailbox m
        JOIN users u ON m.sender_id = u.id
        WHERE m.sender_id = $1 OR m.receiver_id = $1
        ORDER BY m.sent_at DESC
  `;
  const mailboxResult = await db.query(mailboxQuery, [userId]);
  res.render("mailbox", {
    title: "mailbox",
    cssFile: "mailbox.css",
    mailbox: mailboxResult.rows,
    user: req.user,
  });
});

// Composing a new message
app.get("/tenant-dashboard/mailbox/new", (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect("/resident-login");
  }

  // Render the compose message form
  res.render("compose-message", {
    title: "Compose New Message",
    cssFile: "compose-message.css",
    user: req.user, // Pass the logged-in user to the view
  });
});
app.post("/tenant-dashboard/mailbox/send", async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect("/resident-login");
  }

  const { receiver_email, subject, message_content } = req.body;
  try {
    const receiverResult = await db.query(
      "SELECT id FROM users WHERE email = $1",
      [receiver_email]
    );
    if (receiverResult.rows.length === 0) {
      return res.render("compose-message", {
        title: "Compose New Message",
        cssFile: "compose-message.css",
        error: "The specified email does not exist in our database.",
      });
    }
    const receiver_id = receiverResult.rows[0].id;
    // Insert the new message into the mailbox table
    const insertQuery = `
          INSERT INTO mailbox (sender_id, receiver_id, subject, message_content, sent_at)
          VALUES ($1, $2, $3, $4, NOW())
      `;
    await db.query(insertQuery, [
      req.user.id,
      receiver_id,
      subject,
      message_content,
    ]);

    // Redirect back to the mailbox after sending the message
    res.redirect("/tenant-dashboard/mailbox");
  } catch (err) {
    console.error(err);
    res.redirect("/tenant-dashboard/mailbox/new");
  }
});

// Rent payment gateway
app.get("/tenant-dashboard/pay-rent", (req, res) => {
  res.render("create-payment-intent", {
    title: "Payment gateway",
    cssFile: "pay-rent.css",
    user: req.user, // Pass the logged-in user to the view
  });
});

// Handling the payment
app.post("/tenant-dashboard/pay-rent", async (req, res) => {
  const {
    amount,
    card_type,
    card_holder_name,
    card_number,
    expiryMonth,
    expiryYear,
    cvv,
    currency = "CAD", // default to CAD if not specified
  } = req.body;

  const paymentData = {
    app_name: "Tenant Payment App",
    service: "Rent Payment",
    customer_email: req.user.email, // get email from logged-in user
    card_type,
    card_holder_name,
    card_number,
    expiryMonth,
    expiryYear,
    cvv,
    amount,
    currency,
  };

  try {
    // Send paymentData to the fake payment API
    const response = await fetch("http://localhost:5100/api/v1/payment/card", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(paymentData),
    });

    if (!response.ok) throw new Error("Payment failed");

    const responseData = await response.json();

    // Redirect back to the tenant dashboard on success
    res.redirect("/tenant-dashboard");
  } catch (error) {
    console.error("Error processing payment:", error);
    res.status(500).send("Payment processing error");
  }
});

// Home page
app.get("/", (req, res) => {
  res.render("home", { title: "home", cssFile: "styles.css" });
});

app.get("/resident-login", (req, res) => {
  res.render("resident-login", {
    title: "resident login",
    cssFile: "style-login.css",
  });
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
