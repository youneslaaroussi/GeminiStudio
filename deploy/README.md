# GeminiStudio Deployment

Deploy all GeminiStudio backend services on a single GCE VM with Docker Compose.

## Architecture

```
┌─────────────────────┐
│  Vercel / Hosting   │  ← Next.js frontend (app/)
└──────────┬──────────┘
           │
           ▼
┌─────────────────────────────────────────┐
│  GCE VM (e2-standard-2)                 │
│  ┌─────────────────────────────────────┐│
│  │ Docker Compose                      ││
│  │  ├── asset-service      :8081       ││
│  │  ├── video-effects      :8082       ││
│  │  ├── langgraph-server   :8080       ││
│  │  ├── renderer           :4000       ││
│  │  ├── billing-service    :3100       ││
│  │  └── redis                          ││
│  └─────────────────────────────────────┘│
└─────────────────────────────────────────┘
           │
           ▼
┌─────────────────────┐
│ GCP Services        │
│  ├── Secret Manager │
│  ├── Firestore      │
│  ├── Cloud Storage  │
│  └── Pub/Sub        │
└─────────────────────┘
```

## Prerequisites

1. **Google Cloud CLI** installed and authenticated:
   ```bash
   gcloud auth login
   gcloud auth application-default login
   ```

2. **Terraform** installed (v1.0+):
   ```bash
   brew install terraform  # macOS
   ```

3. **GCP Project** with APIs enabled:
   ```bash
   gcloud services enable \
     compute.googleapis.com \
     secretmanager.googleapis.com \
     storage.googleapis.com \
     firestore.googleapis.com \
     pubsub.googleapis.com \
     speech.googleapis.com
   ```

4. **Service Account** JSON file with required roles:
   
   Create a service account for your backend services with these roles:
   - `roles/storage.admin` - GCS bucket access (upload/download assets, renders)
   - `roles/datastore.user` - Firestore access (user data, projects, metadata)
   - `roles/pubsub.publisher` - Pub/Sub publishing (renderer publishes completion events)
   - `roles/pubsub.subscriber` - Pub/Sub subscribing (LangGraph receives render events)
   - `roles/aiplatform.user` - Vertex AI access (Veo video generation)
   - `roles/speech.client` - Speech-to-Text API access (transcription)

   ```bash
   PROJECT_ID="your-project-id"
   
   # Create service account for backend services
   gcloud iam service-accounts create gemini-studio-backend \
     --display-name="GeminiStudio Backend Services"
   
   SA_EMAIL="gemini-studio-backend@${PROJECT_ID}.iam.gserviceaccount.com"

   # Grant required roles
   gcloud projects add-iam-policy-binding $PROJECT_ID \
     --member="serviceAccount:$SA_EMAIL" \
     --role="roles/storage.admin"

   gcloud projects add-iam-policy-binding $PROJECT_ID \
     --member="serviceAccount:$SA_EMAIL" \
     --role="roles/datastore.user"

   gcloud projects add-iam-policy-binding $PROJECT_ID \
     --member="serviceAccount:$SA_EMAIL" \
     --role="roles/pubsub.publisher"

   gcloud projects add-iam-policy-binding $PROJECT_ID \
     --member="serviceAccount:$SA_EMAIL" \
     --role="roles/pubsub.subscriber"

   gcloud projects add-iam-policy-binding $PROJECT_ID \
     --member="serviceAccount:$SA_EMAIL" \
     --role="roles/aiplatform.user"

   gcloud projects add-iam-policy-binding $PROJECT_ID \
     --member="serviceAccount:$SA_EMAIL" \
     --role="roles/speech.client"

   # Create and download key
   gcloud iam service-accounts keys create google-service-account.json \
     --iam-account=$SA_EMAIL
   ```

   **For CI/CD (GitHub Actions)**, create a separate service account:
   ```bash
   # Create CI/CD service account
   gcloud iam service-accounts create gemini-studio-cicd \
     --display-name="GeminiStudio CI/CD"
   
   CICD_SA_EMAIL="gemini-studio-cicd@${PROJECT_ID}.iam.gserviceaccount.com"

   # Grant deployment permissions
   gcloud projects add-iam-policy-binding $PROJECT_ID \
     --member="serviceAccount:$CICD_SA_EMAIL" \
     --role="roles/compute.instanceAdmin.v1"

   gcloud projects add-iam-policy-binding $PROJECT_ID \
     --member="serviceAccount:$CICD_SA_EMAIL" \
     --role="roles/iam.serviceAccountUser"

   # Create and download key for GitHub Actions
   gcloud iam service-accounts keys create cicd-service-account.json \
     --iam-account=$CICD_SA_EMAIL
   ```

5. **VM Default Service Account** - needs Secret Manager and Pub/Sub access:
   ```bash
   # Get the default compute service account (format: PROJECT_NUMBER-compute@developer.gserviceaccount.com)
   COMPUTE_SA=$(gcloud iam service-accounts list --filter="email~compute@developer" --format="value(email)")
   PROJECT_ID="your-project-id"

   # Secret Manager access (to pull secrets during deploy)
   gcloud projects add-iam-policy-binding $PROJECT_ID \
     --member="serviceAccount:$COMPUTE_SA" \
     --role="roles/secretmanager.secretAccessor"

   # Pub/Sub Publisher access (required for renderer to publish completion events)
   gcloud projects add-iam-policy-binding $PROJECT_ID \
     --member="serviceAccount:$COMPUTE_SA" \
     --role="roles/pubsub.publisher"
   ```

## Quick Start

### 1. Create Pub/Sub Topics and Subscriptions

```bash
PROJECT_ID="your-project-id"

# Create topics
gcloud pubsub topics create gemini-render-events --project=$PROJECT_ID
gcloud pubsub topics create gemini-pipeline-events --project=$PROJECT_ID
gcloud pubsub topics create gemini-veo-events --project=$PROJECT_ID

# Create subscription for LangGraph to receive render completion events
gcloud pubsub subscriptions create gemini-render-events-sub \
  --topic=gemini-render-events \
  --ack-deadline=60 \
  --project=$PROJECT_ID
```

### 2. Store Secrets in Secret Manager

```bash
# Required: Gemini API key
echo -n "your-gemini-api-key" | gcloud secrets create gemini-api-key --data-file=-

# Optional: Replicate (if using video effects)
echo -n "r8_xxx" | gcloud secrets create replicate-api-token --data-file=-

# Optional: Algolia (if using search)
echo -n "xxx" | gcloud secrets create algolia-admin-key --data-file=-
```

### 2b. Stripe Setup (if using billing)

**Add Stripe secrets:**

```bash
# Stripe secret key (sk_live_... for production, sk_test_... for testing)
echo -n "sk_live_xxx" | gcloud secrets create stripe-secret-key --data-file=-

# Stripe price IDs (create products in Stripe Dashboard first)
echo -n "price_xxx" | gcloud secrets create stripe-price-starter --data-file=-
echo -n "price_xxx" | gcloud secrets create stripe-price-pro --data-file=-
echo -n "price_xxx" | gcloud secrets create stripe-price-enterprise --data-file=-
```

**Create Stripe webhook:**

1. Go to [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks)
2. Click **"Add endpoint"**
3. Set endpoint URL: `https://geminivideo.studio/credits/webhook`
4. Set API version: Use your **account's default version** (visible in Stripe Dashboard → Developers → API version)
5. Select events:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`
6. Click **"Add endpoint"**
7. Copy the **Signing secret** (starts with `whsec_`)

**Add webhook secret:**

```bash
echo -n "whsec_xxx" | gcloud secrets create stripe-webhook-secret --data-file=-
```

### 3. Configure Terraform

```bash
cd deploy/terraform

# Copy and edit the configuration
cp terraform.tfvars.example terraform.tfvars

# Edit terraform.tfvars:
# - Set project_id
# - Set gcs_bucket_name
# - Enable features you need (billing, video_effects, algolia)
```

### 4. Deploy Infrastructure

```bash
terraform init
terraform plan    # Preview changes
terraform apply   # Create resources
```

This creates:
- GCE VM with Docker installed
- Static external IP
- Firewall rules
- Pub/Sub topics
- `generated.env` file with all configuration

### 4b. GCS CORS (for direct playback and LiveSession media)

Preview and LiveSession use signed URLs so the browser fetches media directly from GCS. **The bucket must have CORS enabled** or you’ll see errors like “blocked by CORS policy: No 'Access-Control-Allow-Origin' header”.

From repo root:

```bash
# Default bucket: geminivideostudio-storage
./deploy/set-gcs-cors.sh

# Or pass your bucket (e.g. from terraform.tfvars / gcs_bucket_name)
./deploy/set-gcs-cors.sh your-bucket-name
```

Equivalent manual step:

```bash
gsutil cors set deploy/gcs-cors.json gs://geminivideostudio-storage
```

Allowed origins: `https://www.geminivideo.studio`, `https://geminivideo.studio`, `http://localhost:3000`. To add more, edit `deploy/gcs-cors.json` and re-run the script.

### 5. Setup the VM

**Important:** CI/CD does NOT copy service account files - they must be manually provisioned on the VM. The `secrets/` folder is gitignored and excluded from deployments.

You need TWO service account files:

1. **google-service-account.json** - GCP service account for Storage, Pub/Sub, Vertex AI, etc.
2. **firebase-service-account.json** - Firebase Admin SDK service account for Auth token verification

**Critical:** The Firebase service account MUST be from the same Firebase project as your client app. If your Firebase project ID is `my-app` but you use a service account from GCP project `my-app-backend`, auth will fail with "incorrect audience claim".

```bash
# Create secrets directory on VM
gcloud compute ssh gemini-studio --zone=us-central1-a --command='sudo mkdir -p /opt/gemini-studio/deploy/secrets'

# Copy the generated .env file
gcloud compute scp ../generated.env gemini-studio:/opt/gemini-studio/deploy/.env \
  --zone=us-central1-a

# Copy GCP service account (for Storage, Pub/Sub, Vertex AI, Speech)
gcloud compute scp ./google-service-account.json gemini-studio:/tmp/google-sa.json \
  --zone=us-central1-a
gcloud compute ssh gemini-studio --zone=us-central1-a --command='sudo mv /tmp/google-sa.json /opt/gemini-studio/deploy/secrets/google-service-account.json && sudo chmod 644 /opt/gemini-studio/deploy/secrets/google-service-account.json'

# Copy Firebase service account (MUST match your Firebase project ID)
# Download from: Firebase Console → Project Settings → Service Accounts → Generate new private key
gcloud compute scp ./firebase-service-account.json gemini-studio:/tmp/firebase-sa.json \
  --zone=us-central1-a
gcloud compute ssh gemini-studio --zone=us-central1-a --command='sudo mv /tmp/firebase-sa.json /opt/gemini-studio/deploy/secrets/firebase-service-account.json && sudo chmod 644 /opt/gemini-studio/deploy/secrets/firebase-service-account.json'

# SSH into the VM
gcloud compute ssh gemini-studio --zone=us-central1-a
```

**Verify the Firebase service account project matches your app:**
```bash
# Check what project the service account belongs to
cat firebase-service-account.json | python3 -c "import sys,json; print(json.load(sys.stdin)['project_id'])"

# This MUST match NEXT_PUBLIC_FIREBASE_PROJECT_ID in your .env
```

### 6. Setup CI/CD (GitHub Actions)

Add your service account as a GitHub secret:

1. Go to your repo → Settings → Secrets and variables → Actions
2. Create new secret: `GCP_SERVICE_ACCOUNT_KEY`
3. Value: paste the contents of your service account JSON file

### 7. Deploy

Push to main branch to trigger deployment:

```bash
git add .
git commit -m "Add deployment configuration"
git push origin main
```

GitHub Actions will:
- SSH into the VM
- Clone/pull the latest code
- Run `docker compose up -d --build`
- Verify services are healthy

### 8. Configure Frontend

Get the environment variables for your frontend:

```bash
terraform output frontend_env_vars
```

Add these to your Vercel dashboard (Settings → Environment Variables).

## Day-to-Day Operations

### Portainer (container management UI)

Portainer runs in the stack and is available at **https://portainer.your-domain** (e.g. `https://portainer.geminivideo.studio`). Caddy provides HTTPS; no extra ports are exposed.

- **First visit:** Create an admin username and password (no default credentials).
- Use it to restart containers, view logs, manage stacks, and inspect resources.

Ensure DNS has an A record for `portainer.<your-domain>` pointing at the VM’s IP (same as the main app), or add it to your hosts file for local use.

### View Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f asset-service
```

### Restart Services

```bash
# Restart all
docker compose restart

# Restart specific service
docker compose restart renderer
```

### Update Code

```bash
cd /opt/gemini-studio
git pull
cd deploy
docker compose up -d --build
```

### Update Configuration

Edit `terraform.tfvars`, then:

```bash
terraform apply

# Copy updated .env to VM
gcloud compute scp ../generated.env gemini-studio:/opt/gemini-studio/deploy/.env \
  --zone=us-central1-a

# Restart services to pick up changes
gcloud compute ssh gemini-studio --zone=us-central1-a -- \
  "cd /opt/gemini-studio/deploy && docker compose restart"
```

## Cleanup

```bash
cd deploy/terraform
terraform destroy
```

This removes:
- GCE VM and disk
- Static IP
- Firewall rules
- Pub/Sub topics

**Not deleted:** GCS buckets, Firestore data, Secret Manager secrets.

## Troubleshooting

### Service won't start

```bash
docker compose logs <service-name>
docker compose down
docker compose up -d --build
```

### Auth 401 errors / "incorrect audience claim"

If you see errors like:
```
Firebase ID token has incorrect "aud" (audience) claim. Expected "project-a" but got "project-b"
```

This means your `firebase-service-account.json` is from a different project than your Firebase Auth. The service account MUST be from the same Firebase project where users authenticate.

**Fix:**
1. Go to [Firebase Console](https://console.firebase.google.com) → Your Project → Project Settings → Service Accounts
2. Click "Generate new private key"
3. Copy to VM:
   ```bash
   gcloud compute scp firebase-service-account.json gemini-studio:/tmp/firebase-sa.json --zone=us-central1-a
   gcloud compute ssh gemini-studio --zone=us-central1-a --command='sudo mv /tmp/firebase-sa.json /opt/gemini-studio/deploy/secrets/firebase-service-account.json && sudo chmod 644 /opt/gemini-studio/deploy/secrets/firebase-service-account.json'
   ```
4. Restart frontend:
   ```bash
   gcloud compute ssh gemini-studio --zone=us-central1-a --command='sudo docker compose -f /opt/gemini-studio/deploy/docker-compose.yml restart frontend'
   ```

### Out of memory

Reduce renderer concurrency or upgrade VM:

```hcl
# In terraform.tfvars
renderer_concurrency = 1
# or
machine_type = "e2-standard-4"
```

### Permission errors

Ensure service account has required roles. Common permission issues:

**Renderer Pub/Sub errors** (`PERMISSION_DENIED: User not authorized to perform this action`):

The renderer service publishes render completion/failure events to Pub/Sub. If you see this error in renderer logs, the service account JSON file needs Pub/Sub Publisher permissions:

```bash
PROJECT_ID=$(gcloud config get-value project)

# Find which service account is being used
gcloud compute ssh gemini-studio --zone=us-central1-a --command='sudo cat /opt/gemini-studio/deploy/secrets/google-service-account.json | grep client_email'

# Grant Pub/Sub Publisher role (replace with the email from above)
SERVICE_ACCOUNT="your-service-account@your-project.iam.gserviceaccount.com"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SERVICE_ACCOUNT" \
  --role="roles/pubsub.publisher"

# Restart renderer to apply changes
gcloud compute ssh gemini-studio --zone=us-central1-a --command='sudo docker compose -f /opt/gemini-studio/deploy/docker-compose.yml restart renderer'
```

**Important**: The Docker containers use the service account JSON file mounted at `/app/secrets/google-service-account.json`, NOT the VM's compute service account. Make sure you grant permissions to the correct service account.

**LangGraph not receiving render events**:

The LangGraph server subscribes to render completion events via Pub/Sub. If renders complete but the user isn't notified:

```bash
PROJECT_ID=$(gcloud config get-value project)

# 1. Verify the subscription exists
gcloud pubsub subscriptions describe gemini-render-events-sub

# If it doesn't exist, create it
gcloud pubsub subscriptions create gemini-render-events-sub \
  --topic=gemini-render-events \
  --ack-deadline=60

# 2. Grant subscriber permissions to the service account
SERVICE_ACCOUNT="your-service-account@your-project.iam.gserviceaccount.com"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SERVICE_ACCOUNT" \
  --role="roles/pubsub.subscriber"

# 3. Restart LangGraph to pick up permissions
gcloud compute ssh gemini-studio --zone=us-central1-a --command='sudo docker compose -f /opt/gemini-studio/deploy/docker-compose.yml restart langgraph-server'

# 4. Check logs to verify subscription is active
gcloud compute ssh gemini-studio --zone=us-central1-a --command='sudo docker compose -f /opt/gemini-studio/deploy/docker-compose.yml logs langgraph-server --tail=50'
```

Look for log messages like:
- `"Subscribed to render events on gemini-render-events-sub"` - subscription is active
- `"Dispatched render event to agent"` - events are being received and processed

**Clearing queues and calming a runaway system**:

From the repo root, run one script (no HTTP endpoint):

   ```bash
   ./scripts/clear-queues.sh              # drain render queue (waiting only), seek Pub/Sub
   ./scripts/clear-queues.sh --obliterate # same but remove ALL render jobs
   ```

   The script: (1) drains the BullMQ render queue (uses `renderer/.env` for `REDIS_URL`), (2) seeks the three Pub/Sub subscriptions to drop backlog, (3) reminds you to restart LangGraph. **Restart LangGraph** after (local: restart uvicorn; deploy: `docker compose -f deploy/docker-compose.yml restart langgraph-server`).


**Render upload 403 (GCS Access denied)**:

The renderer uploads the finished video to GCS using a **signed PUT URL** generated by the LangGraph server. The credentials used for that (from `FIREBASE_SERVICE_ACCOUNT_KEY` / the service account JSON) must be allowed to create objects in the bucket. If you see an error like:

```
Access denied. ... does not have storage.objects.create access to the Google Cloud Storage object.
```

grant that service account the **Storage Object Creator** role on the bucket. Get the service account email from your key file (`client_email`), then:

```bash
BUCKET="your-bucket-name"
SA_EMAIL="your-service-account@your-project.iam.gserviceaccount.com"  # from client_email in your JSON key

gsutil iam ch serviceAccount:${SA_EMAIL}:objectCreator gs://${BUCKET}
```

Or with gcloud (bucket-level IAM):

```bash
gcloud storage buckets add-iam-policy-binding gs://${BUCKET} \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/storage.objectCreator"
```

Use the same bucket as `GOOGLE_CLOUD_STORAGE_BUCKET` (or `ASSET_GCS_BUCKET`) in your deploy config. After applying, re-run a render; no container restart needed.

**Render download / Telegram video 403 (storage.objects.get)**:

When sending the rendered video to Telegram (or when anyone opens the "Download Video" link), the client fetches the signed **GET** URL. The same service account that generates those URLs must have **read** access to the bucket. If you see:

```
Access denied. ... does not have storage.objects.get access to the Google Cloud Storage object.
```

or Telegram reports "failed to get HTTP URL content" / "wrong type of the web page content", grant that service account **Storage Object Viewer** on the bucket:

```bash
BUCKET="your-bucket-name"
SA_EMAIL="your-service-account@your-project.iam.gserviceaccount.com"  # same as above, from client_email in your JSON key

gcloud storage buckets add-iam-policy-binding gs://${BUCKET} \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/storage.objectViewer"
```

For both upload and download to work, the SA needs **Object Creator** (for signed PUT) and **Object Viewer** (for signed GET). You can grant both in one go:

```bash
gcloud storage buckets add-iam-policy-binding gs://${BUCKET} \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/storage.objectAdmin"
```

**Secret Manager errors**:

```bash
gcloud projects add-iam-policy-binding PROJECT_ID \
   --member="serviceAccount:SA@PROJECT.iam.gserviceaccount.com" \
   --role="roles/secretmanager.secretAccessor"
```

### Can't connect to services

```bash
# Check firewall
gcloud compute firewall-rules describe gemini-studio-firewall

# Check services are running
docker compose ps

# Check service is bound to 0.0.0.0
docker compose logs <service> | grep listening
```

## Cost Estimate

| Resource | Specification | Monthly Cost |
|----------|---------------|--------------|
| GCE VM (e2-standard-2) | 2 vCPU, 8 GB RAM | ~$50 |
| Boot Disk (50 GB) | pd-balanced | ~$5 |
| Static IP | When attached | $0 |
| Secret Manager | Per access | ~$0.50 |
| Firestore | Free tier | $0 |
| Cloud Storage | Per GB | ~$5 |
| Pub/Sub | Free tier | $0 |
| **Total** | | **~$55-60/month** |
