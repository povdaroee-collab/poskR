const admin = require("firebase-admin");
require("dotenv").config();

const privateKey = process.env.FIREBASE_PRIVATE_KEY
  ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
  : undefined;

if (!privateKey) {
  console.error("❌ Error: រកមិនឃើញ FIREBASE_PRIVATE_KEY ទេ។");
}

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL, // វានឹងយកអ៊ីមែលវែងៗ (Service Account)
    privateKey: privateKey,
  })
});

const db = admin.firestore();
module.exports = { admin, db };