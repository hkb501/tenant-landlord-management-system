import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import env from "dotenv";

const app = express();
const port = 3000;

env.config();

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
app.set("view engine", "ejs");
app.set("views", "./views");

const db = new pg.Client({
  user: process.env.PG_USER,
  host: process.env.PG_HOST,
  database: process.env.PG_DATABASE,
  password: process.env.PG_PASSWORD,
  port: process.env.PG_PORT,
});
db.connect();

app.get("/", (req, res) => {
  res.render("home", { title: "home" });
});

app.get("/login", (req, res) => {
  res.render("login", { title: "login" });
});

app.get("/landlord-login", (req, res) => {
  res.render("landlord-login", { title: "landlord login" });
});

app.get("/resident-login", (req, res) => {
  res.render("resident-login", { title: "resident login" });
});

app.get("/resident-login", (req, res) => {
  res.render("resident-login", { title: "resident login" });
});
app.get("/resident-forgotpassword", (req, res) => {
  res.render("resident-forgotpassword", { title: "resident forgot password" });
});
app.get("/landlord-forgotpassword", (req, res) => {
  res.render("landlord-forgotpassword", { title: "landlord forgot password" });
});
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
