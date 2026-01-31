import { NextRequest, NextResponse } from "next/server";
import { initAdmin, getAdminFirestore, getAdminAuth } from "@/app/lib/server/firebase-admin";
import { getAuth } from "firebase-admin/auth";
import { getBilling } from "@/app/lib/server/credits";
import { deleteGcsObject } from "@/app/lib/server/gcs-upload";
import {
  isAssetServiceEnabled,
  deleteUserFromAssetService,
} from "@/app/lib/server/asset-service-client";

async function verifyToken(request: NextRequest): Promise<string | null> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }
  const token = authHeader.slice(7);
  try {
    await initAdmin();
    const decoded = await getAuth().verifyIdToken(token);
    return decoded.uid;
  } catch {
    return null;
  }
}

interface DeletionStats {
  projectsDeleted: number;
  assetsDeleted: number;
  gcsObjectsDeleted: number;
  settingsDeleted: number;
  integrationsDeleted: number;
  errors: string[];
}

/**
 * POST /api/account/delete – Delete user account and all associated data.
 * Requires Authorization: Bearer <firebase-id-token>.
 *
 * This will:
 * 1. Check for active subscriptions (block if active)
 * 2. Delete all user's assets from GCS (via asset service or directly)
 * 3. Delete all user's projects from Firestore
 * 4. Delete user settings (billing, integrations)
 * 5. Clean up telegram integrations
 * 6. Delete the user from Firebase Auth
 */
export async function POST(request: NextRequest) {
  const uid = await verifyToken(request);
  if (!uid) {
    return NextResponse.json(
      { error: "Unauthorized. Include Authorization: Bearer <token>" },
      { status: 401 }
    );
  }

  const stats: DeletionStats = {
    projectsDeleted: 0,
    assetsDeleted: 0,
    gcsObjectsDeleted: 0,
    settingsDeleted: 0,
    integrationsDeleted: 0,
    errors: [],
  };

  try {
    // 1. Check for active subscription
    const billing = await getBilling(uid);
    if (
      billing.tier &&
      billing.subscriptionStatus === "active" &&
      !billing.cancelAtPeriodEnd
    ) {
      return NextResponse.json(
        {
          error:
            "Cannot delete account with an active subscription. Please cancel your subscription first.",
        },
        { status: 400 }
      );
    }

    const db = await getAdminFirestore();

    // 2. Delete all assets via asset service (if enabled)
    if (isAssetServiceEnabled()) {
      try {
        const result = await deleteUserFromAssetService(uid);
        stats.assetsDeleted = result.assetsDeleted;
        stats.gcsObjectsDeleted = result.gcsObjectsDeleted;
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        stats.errors.push(`Asset service deletion failed: ${msg}`);
        console.error("Asset service deletion failed:", error);
      }
    } else {
      // Fallback: Delete assets directly from GCS by listing projects and their assets
      try {
        const projectsRef = db.collection(`users/${uid}/projects`);
        const projectsSnap = await projectsRef.get();

        for (const projectDoc of projectsSnap.docs) {
          const projectId = projectDoc.id;

          // Get assets for this project
          const assetsRef = db.collection(`users/${uid}/projects/${projectId}/assets`);
          const assetsSnap = await assetsRef.get();

          for (const assetDoc of assetsSnap.docs) {
            const assetData = assetDoc.data();
            if (assetData.gcsUri) {
              try {
                await deleteGcsObject(assetData.gcsUri);
                stats.gcsObjectsDeleted++;
              } catch (error) {
                const msg = error instanceof Error ? error.message : "Unknown error";
                stats.errors.push(`Failed to delete GCS object ${assetData.gcsUri}: ${msg}`);
              }
            }
            // Delete asset document
            await assetDoc.ref.delete();
            stats.assetsDeleted++;
          }
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        stats.errors.push(`Direct asset deletion failed: ${msg}`);
        console.error("Direct asset deletion failed:", error);
      }
    }

    // 3. Delete all projects
    try {
      const projectsRef = db.collection(`users/${uid}/projects`);
      const projectsSnap = await projectsRef.get();

      for (const projectDoc of projectsSnap.docs) {
        // Delete any subcollections (assets should already be deleted, but clean up just in case)
        const assetsRef = db.collection(`users/${uid}/projects/${projectDoc.id}/assets`);
        const assetsSnap = await assetsRef.get();
        for (const assetDoc of assetsSnap.docs) {
          await assetDoc.ref.delete();
        }

        await projectDoc.ref.delete();
        stats.projectsDeleted++;
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      stats.errors.push(`Project deletion failed: ${msg}`);
      console.error("Project deletion failed:", error);
    }

    // 4. Clean up telegram integration (if exists)
    try {
      const integrationsRef = db.doc(`users/${uid}/settings/integrations`);
      const integrationsSnap = await integrationsRef.get();

      if (integrationsSnap.exists) {
        const data = integrationsSnap.data();
        if (data?.telegram?.telegramChatId) {
          // Delete from telegramIntegrations collection
          await db.doc(`telegramIntegrations/${data.telegram.telegramChatId}`).delete();
          stats.integrationsDeleted++;
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      stats.errors.push(`Telegram integration cleanup failed: ${msg}`);
      console.error("Telegram cleanup failed:", error);
    }

    // 5. Delete pending telegram link codes
    try {
      const pendingLinkRef = db.doc(`users/${uid}/settings/pendingTelegramLink`);
      const pendingLinkSnap = await pendingLinkRef.get();

      if (pendingLinkSnap.exists) {
        const data = pendingLinkSnap.data();
        if (data?.code) {
          await db.doc(`telegramLinkCodes/${data.code}`).delete();
        }
        await pendingLinkRef.delete();
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      stats.errors.push(`Pending link code cleanup failed: ${msg}`);
    }

    // 6. Delete user settings documents
    try {
      const settingsCollection = db.collection(`users/${uid}/settings`);
      const settingsSnap = await settingsCollection.get();

      for (const settingDoc of settingsSnap.docs) {
        await settingDoc.ref.delete();
        stats.settingsDeleted++;
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      stats.errors.push(`Settings deletion failed: ${msg}`);
      console.error("Settings deletion failed:", error);
    }

    // 7. Delete the user document itself
    try {
      await db.doc(`users/${uid}`).delete();
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      stats.errors.push(`User document deletion failed: ${msg}`);
      console.error("User document deletion failed:", error);
    }

    // 8. Delete the Firebase Auth user (from server side)
    try {
      const auth = await getAdminAuth();
      await auth.deleteUser(uid);
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      // Auth user deletion failure is critical, but we've already deleted data
      // The client will also try to delete the auth user
      stats.errors.push(`Firebase Auth user deletion failed: ${msg}`);
      console.error("Firebase Auth deletion failed:", error);
    }

    console.log(`[ACCOUNT_DELETE] User ${uid} deleted:`, stats);

    return NextResponse.json({
      success: true,
      message: "Account deleted successfully",
      stats,
    });
  } catch (error) {
    console.error("Account deletion failed:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Account deletion failed: ${msg}`, stats },
      { status: 500 }
    );
  }
}
