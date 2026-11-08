import express from "express";
import cors from "cors";
import { MongoClient } from "mongodb";

const app = express();
const port = process.env.PORT || 8000;

app.use(cors());
app.use(express.json());

const client = new MongoClient(process.env.MONGO_DB_URL);
export async function connectToMongoDB() {
    try {
        await client.connect;
        console.log("Successfully conntct to MongoDB");
        return client;
    } catch (error) {
        console.dir(error)
    }
}

connectToMongoDB();

app.get("/", (req, res) => {
    res.send("Hire loop is looping!")
})

app.listen(port, (req, res) => {
    console.log(`Explore hire loop on port ${port}`)
})