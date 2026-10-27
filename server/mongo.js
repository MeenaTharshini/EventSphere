
const { MongoClient } = require("mongodb");

let client;
let database;

async function connectMongoDB() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error("MONGODB_URI is missing from the .env file");
  }

  client = new MongoClient(uri);

  await client.connect();

  database = client.db("eventsphere");

  // Verify that the database connection works.
  await database.command({ ping: 1 });

  console.log("MongoDB Atlas connected successfully!");

  return database;
}

function getMongoDB() {
  if (!database) {
    throw new Error("MongoDB is not connected yet");
  }

  return database;
}

async function closeMongoDB() {
  if (client) {
    await client.close();
    client = undefined;
    database = undefined;
  }
}

module.exports = {
  connectMongoDB,
  getMongoDB,
  closeMongoDB,
};
