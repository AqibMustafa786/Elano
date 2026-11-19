import { FirebaseError } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
} from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";

import { getFirebaseServices } from "./client";

export function authErrorMessage(error: unknown): string {
  if (!(error instanceof FirebaseError)) {
    return "Something went wrong. Please try again.";
  }

  switch (error.code) {
    case "auth/email-already-in-use":
      return "An account with this email already exists.";
    case "auth/invalid-email":
      return "Enter a valid email address.";
    case "auth/weak-password":
      return "Password must be at least 8 characters.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Incorrect email or password.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a moment and try again.";
    case "auth/network-request-failed":
      return "Network error. Check your connection.";
    case "auth/unauthorized-domain":
      return "This domain is not authorized in Firebase Authentication settings.";
    default:
      return "Something went wrong. Please try again.";
  }
}

export async function registerCustomer(input: {
  name: string;
  email: string;
  password: string;
}) {
  const { auth, db } = getFirebaseServices();
  const email = input.email.trim().toLowerCase();
  const displayName = input.name.trim();

  const credential = await createUserWithEmailAndPassword(auth, email, input.password);
  await updateProfile(credential.user, { displayName });

  // Keys must match the hasOnly() list in firestore.rules (users create rule).
  await setDoc(doc(db, "users", credential.user.uid), {
    uid: credential.user.uid,
    displayName,
    email,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await sendEmailVerification(credential.user).catch(() => undefined);
  return credential.user;
}

export async function loginCustomer(email: string, password: string) {
  const { auth } = getFirebaseServices();
  const credential = await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
  return credential.user;
}

export async function logoutCustomer() {
  await signOut(getFirebaseServices().auth);
}

export async function requestPasswordReset(email: string) {
  await sendPasswordResetEmail(getFirebaseServices().auth, email.trim().toLowerCase());
}
