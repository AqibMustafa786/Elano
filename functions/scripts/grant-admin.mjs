import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const uid = process.argv[2];
if (!uid) {
  throw new Error("Pass the Firebase Auth UID: npm run grant-admin -- <uid>");
}

const app = initializeApp({
  credential: applicationDefault(),
  projectId: process.env.GCLOUD_PROJECT ?? "elano-ac833",
});
const auth = getAuth(app);
const user = await auth.getUser(uid);

await auth.setCustomUserClaims(uid, {
  ...user.customClaims,
  admin: true,
});

console.info(`Granted the admin claim to Firebase Auth user ${uid}.`);
