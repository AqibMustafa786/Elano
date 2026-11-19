import { createHash } from "node:crypto";

import { initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { setGlobalOptions } from "firebase-functions/v2";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { z } from "zod";

export { getAnalyticsReport } from "./analytics.js";
export { claimSuperAdmin, createStaff, listStaff, removeStaff, updateStaff } from "./staff.js";

initializeApp();
setGlobalOptions({
  region: "asia-south1",
  maxInstances: 10,
});

const newsletterInput = z.object({
  email: z.string().trim().email().max(254),
});

export const subscribeToNewsletter = onCall(
  {
    enforceAppCheck: true,
    maxInstances: 5,
  },
  async (request) => {
    const parsedInput = newsletterInput.safeParse(request.data);
    if (!parsedInput.success) {
      throw new HttpsError("invalid-argument", "Enter a valid email address.");
    }

    const email = parsedInput.data.email.toLowerCase();
    const subscriberId = createHash("sha256").update(email).digest("hex");

    const subscriberRef = getFirestore()
      .collection("newsletterSubscribers")
      .doc(subscriberId);

    await getFirestore().runTransaction(async (transaction) => {
      const subscriber = await transaction.get(subscriberRef);
      transaction.set(
        subscriberRef,
        {
          email,
          status: "subscribed",
          source: "website",
          updatedAt: FieldValue.serverTimestamp(),
          ...(subscriber.exists
            ? {}
            : { createdAt: FieldValue.serverTimestamp() }),
        },
        { merge: true },
      );
    });

    return { success: true };
  },
);
