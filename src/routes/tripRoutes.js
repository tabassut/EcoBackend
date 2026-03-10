const express = require("express");
const router = express.Router();

const { saveTrip, getTrips } = require("../controllers/tripController");

router.post("/trip", saveTrip);

router.get("/trips/:userId", getTrips);

module.exports = router;

