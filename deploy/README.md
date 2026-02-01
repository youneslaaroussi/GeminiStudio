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
   - `roles/compute.instanceAdmin.v1` - SSH access to VMs (required for CI/CD)
   - `roles/iam.serviceAccountUser` - Act as VM service account (required for SSH)
   - `roles/storage.admin` - GCS bucket access
   - `roles/datastore.user` - Firestore access
   - `roles/pubsub.publisher` - Pub/Sub publishing
   - `roles/secretmanager.secretAccessor` - Read secrets

   Grant these roles to your CI/CD service account:
   ```bash
   SA_EMAIL="your-service-account@your-project.iam.gserviceaccount.com"
   PROJECT_ID="your-project-id"

   gcloud projects add-iam-policy-binding $PROJECT_ID \
     --member="serviceAccount:$SA_EMAIL" \
     --role="roles/compute.instanceAdmin.v1"

   gcloud projects add-iam-policy-binding $PROJECT_ID \
     --member="serviceAccount:$SA_EMAIL" \
     --role="roles/iam.serviceAccountUser"

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
     --role="roles/secretmanager.secretAccessor"
   ```

5. **VM Default Service Account** - needs Secret Manager access to pull secrets during deploy:
   ```bash
   # Get the default compute service account (format: PROJECT_NUMBER-compute@developer.gserviceaccount.com)
   COMPUTE_SA=$(gcloud iam service-accounts list --filter="email~compute@developer" --format="value(email)")
   PROJECT_ID="your-project-id"

   gcloud projects add-iam-policy-binding $PROJECT_ID \
     --member="serviceAccount:$COMPUTE_SA" \
     --role="roles/secretmanager.secretAccessor"
   ```

## Quick Start

### 1. Store Secrets in Secret Manager

```bash
# Required: Gemini API key
gcloud secrets create gemini-api-key \
  --data-file=- <<< "your-gemini-api-key"

# Optional: Stripe (if using billing)
gcloud secrets create stripe-secret-key \
  --data-file=- <<< "sk_xxx"

# Optional: Replicate (if using video effects)
gcloud secrets create replicate-api-token \
  --data-file=- <<< "r8_xxx"

# Optional: Algolia (if using search)
gcloud secrets create algolia-admin-key \
  --data-file=- <<< "xxx"
```

### 2. Configure Terraform

```bash
cd deploy/terraform

# Copy and edit the configuration
cp terraform.tfvars.example terraform.tfvars

# Edit terraform.tfvars:
# - Set project_id
# - Set gcs_bucket_name
# - Enable features you need (billing, video_effects, algolia)
```

### 3. Deploy Infrastructure

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

### 4. Setup the VM

```bash
# Copy the generated .env file
gcloud compute scp ../generated.env gemini-studio:/opt/gemini-studio/deploy/.env \
  --zone=us-central1-a

# Copy your service account JSON
gcloud compute scp ./service-account.json gemini-studio:/opt/gemini-studio/deploy/secrets/ \
  --zone=us-central1-a

# SSH into the VM
gcloud compute ssh gemini-studio --zone=us-central1-a
```

### 5. Setup CI/CD (GitHub Actions)

Add your service account as a GitHub secret:

1. Go to your repo → Settings → Secrets and variables → Actions
2. Create new secret: `GCP_SERVICE_ACCOUNT_KEY`
3. Value: paste the contents of your service account JSON file

### 6. Deploy

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

### 7. Configure Frontend

Get the environment variables for your frontend:

```bash
terraform output frontend_env_vars
```

Add these to your Vercel dashboard (Settings → Environment Variables).

## Day-to-Day Operations

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

### Out of memory

Reduce renderer concurrency or upgrade VM:

```hcl
# In terraform.tfvars
renderer_concurrency = 1
# or
machine_type = "e2-standard-4"
```

### Permission errors

Ensure service account has required roles:

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
