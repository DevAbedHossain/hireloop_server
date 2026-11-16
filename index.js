import "dotenv/config";
import express from "express";
import cors from "cors";
import { MongoClient, ObjectId } from "mongodb";
import Stripe from "stripe";


const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = 5000;

app.use(cors());
app.use(express.json());

const client = new MongoClient(process.env.MONGO_DB_URL);
export async function connectToMongoDB() {
    try {
        await client.connect();
        console.log("You successfully connected to MongoDB!");
        return client;
    } catch (err) {
        console.dir(err);
    }
}

const connectedClient = await connectToMongoDB();
const db = connectedClient.db("hireloopdb");
const usersCollection = db.collection("user");
const jobsCollection = db.collection("jobs");
const sessionCollection = db.collection("session");
const jobApplicationCollection = db.collection("applications");
const payments = db.collection("payments");

const verifyToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    console.log("authHeader", authHeader)
    // if (!authHeader) {
    //     res.status(403).send({ message: "Unauthorized!" });
    //     return;
    // }

    // const token = authHeader.split(" ")[1];
    // if (!token) {
    //     res.status(403).send({ message: "Unauthorized!" });
    //     return;
    // }

    // const sessions = await sessionCollection.findOne({ token });
    // if (!sessions) {
    //     res.status(403).send({ message: "Unauthorized!" });
    //     return;
    // }

    // const userQuery = { _id: new ObjectId(sessions.userId) };
    // const user = await usersCollection.findOne(userQuery);
    // if (!user) {
    //     res.status(403).send({ message: "Unauthorized!" });
    //     return;
    // }

    // req.user = user;
    next();

}

app.get("/", (req, res) => {
    res.send("Hire loop is looping!")
})

app.get("/users", async (req, res) => {
    const result = await usersCollection.find().toArray();
    res.send(result);
})

app.get("/user/:id/premium", async (req, res) => {
    const { id } = req.params;
    const result = await usersCollection.findOne({ _id: new ObjectId(id) }, { projection: { premium: 1 } });
    res.send(result)
})

app.patch("/user/:id/role", async (req, res) => {
    const { id } = req.params;
    const updateRole = req.body.role;

    // Keep the DB in sync with the roles the UI can render.
    const allowedRoles = ["seeker", "recruiter", "admin"];
    if (!allowedRoles.includes(updateRole)) {
        return res.status(400).send({ success: false, message: "Invalid role" });
    }

    try {
        const result = await usersCollection.updateOne(
            { _id: new ObjectId(id) },
            {
                $set: {
                    role: updateRole,
                    updatedAt: new Date(),
                }
            }
        );

        if (result.matchedCount === 0) {
            return res.status(404).send({ success: false, message: "User not found" });
        }

        res.send(result);
    } catch (err) {
        console.error(err);
        res.status(500).send({ success: false, message: "Role update failed", error: err.message });
    }
})

app.post("/jobs", async (req, res) => {
    const newJobs = req.body;
    const result = await jobsCollection.insertOne(newJobs);
    res.send(result);
})

app.get("/jobs", async (req, res) => {

    const query = {};

    console.log("query data", req.query, req.query.jobType);

    // Filter by job type
    if (req.query.jobType) {
        query.jobType = req.query.jobType;
        // query.category = { $regex: `^${req.query.category}$`, $options: "i" };
    }

    // Filter by remote status
    if (req.query.isRemote) {
        query.isRemote = req.query.isRemote === "true";
    }

    if (req.query.category) {
        // query.category = req.query.category;
        query.category = { $regex: `^${req.query.category}$`, $options: "i" };
    }

    if (req.query.recureterId) {
        query.recureterId = req.query.recureterId;
    }

    // Search by title, description, and requirements
    if (req.query.search) {
        query.$or = [
            { title: { $regex: req.query.search, $options: "i" } },
            { responsibilities: { $regex: req.query.search, $options: "i" } },
            { requirements: { $regex: req.query.search, $options: "i" } }
        ];
    }

    const result = await jobsCollection.find(query).toArray();

    res.send(result);
});

app.get("/job/:id", async (req, res) => {
    const { id } = req.params;
    const result = await jobsCollection.findOne({ _id: new ObjectId(id) });
    res.send(result);
})

app.delete("/job/:id", async (req, res) => {
    const { id } = req.params;
    const result = await jobsCollection.deleteOne({ _id: new ObjectId(id) });
    res.send(result);
})

app.post("/application", async (req, res) => {
    const newApplication = req.body;
    const result = await jobApplicationCollection.insertOne(newApplication);
    res.send(result);
})

app.get("/applications", verifyToken, async (req, res) => {

    console.log("headers on the server", req.headers);

    const query = {};

    if (req.query.userId) {
        query.userId = req.query.userId;
    }

    if (req.query.jobId) {
        // const jobQuery = { _id: new ObjectId(req.query.jobId) };
        // const job = await jobsCollection.findOne(jobQuery);
        // if (job.recureterId !== req.user._id.toString() && req.user.role !== "admin") {
        //     res.status(403).send({ message: "Unauthorized!" });
        //     return;
        // }
        query.jobId = req.query.jobId;
    }

    const applications = await jobApplicationCollection.find(query).toArray();

    // Enrich with the applicant's name (one query for all unique seekers) so
    // the recruiter review view can show "name + email" instead of email only.
    const userIds = [...new Set(applications.map(app => app.userId).filter(Boolean))];
    const objectIds = userIds
        .map(id => {
            try {
                return new ObjectId(id);
            } catch {
                return null;
            }
        })
        .filter(Boolean);

    const users = objectIds.length
        ? await usersCollection
            .find({ _id: { $in: objectIds } })
            .project({ name: 1 })
            .toArray()
        : [];

    const nameById = new Map(users.map(user => [user._id.toString(), user.name]));
    const result = applications.map(app => ({
        ...app,
        applicantName: nameById.get(app.userId) ?? null,
    }));

    res.send(result);
})

app.get("/applications/count", async (req, res) => {
    const query = {};
    if (req.query.userId) {
        query.userId = req.query.userId;
    }

    const result = await jobApplicationCollection.countDocuments(query);
    res.send({ count: result });
})

app.patch("/application/:id/status", async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    // Keep the DB in sync with the statuses the UI can render.
    const allowedStatuses = ["Applied", "Review", "Shortlisted", "Rejected", "Offered"];
    if (!allowedStatuses.includes(status)) {
        return res.status(400).send({ success: false, message: "Invalid status" });
    }

    try {
        const result = await jobApplicationCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { status, updatedAt: new Date() } }
        );

        if (result.matchedCount === 0) {
            return res.status(404).send({ success: false, message: "Application not found" });
        }

        res.send({ success: true, message: "Application status updated", result });
    } catch (err) {
        console.error(err);
        res.status(500).send({ success: false, message: "Status update failed", error: err.message });
    }
})

app.delete("/application/:id", async (req, res) => {
    const { id } = req.params;
    const result = await jobApplicationCollection.deleteOne({ _id: new ObjectId(id) });
    res.send(result);
})

app.post("/payments/checkout-verify", async (req, res) => {
    const { sessionId } = req.body;

    if (!sessionId) {
        return res.send({ success: false, message: "Session ID is required" });
    }

    const {
        status,
        payment_status,
        customer_email,
        metadata,
        payment_intent,
    } = await stripe.checkout.sessions.retrieve(sessionId);

    if (status === 'complete' && payment_status === "paid") {

        const sessionQuery = { sessionId };
        const existingPayment = await payments.findOne(sessionQuery);
        if (existingPayment) {
            return res.send({ success: false, message: "Payment already verified" });
        }

        const payment = {
            sessionId,
            status,
            payment_status,
            customer_email,
            payment_date: new Date(),
            userId: metadata.userId,
            payment_intent,
        };

        const result = await payments.insertOne(payment);

        const query = { _id: new ObjectId(metadata.userId) };
        const updateDoc = {
            $set: {
                premium: true,
            }
        }

        const updateResult = await usersCollection.updateOne(query, updateDoc);

        res.send({ success: true, message: "Payment Verified!", result, updateResult })
        return;
    }
    res.send({ success: false, message: "Payment verification failed!" });


})

app.listen(port, () => {
    console.log(`Explore hire loop on port ${port}`)
})