# Google Secret Manager Configuration
# Secrets are created externally and referenced here

# Enable Secret Manager API
resource "google_project_service" "secretmanager" {
  service            = "secretmanager.googleapis.com"
  disable_on_destroy = false
}

# Data sources to read existing secrets
data "google_secret_manager_secret_version" "gemini_api_key" {
  count   = var.use_secret_manager ? 1 : 0
  secret  = "gemini-api-key"
  project = var.project_id

  depends_on = [google_project_service.secretmanager]
}

data "google_secret_manager_secret_version" "stripe_secret_key" {
  count   = var.use_secret_manager && var.enable_billing ? 1 : 0
  secret  = "stripe-secret-key"
  project = var.project_id

  depends_on = [google_project_service.secretmanager]
}

data "google_secret_manager_secret_version" "replicate_api_token" {
  count   = var.use_secret_manager && var.enable_video_effects ? 1 : 0
  secret  = "replicate-api-token"
  project = var.project_id

  depends_on = [google_project_service.secretmanager]
}

data "google_secret_manager_secret_version" "algolia_admin_key" {
  count   = var.use_secret_manager && var.enable_algolia ? 1 : 0
  secret  = "algolia-admin-key"
  project = var.project_id

  depends_on = [google_project_service.secretmanager]
}

data "google_secret_manager_secret_version" "asset_service_shared_secret" {
  count   = var.use_secret_manager ? 1 : 0
  secret  = "asset-service-shared-secret"
  project = var.project_id

  depends_on = [google_project_service.secretmanager]
}

data "google_secret_manager_secret_version" "renderer_shared_secret" {
  count   = var.use_secret_manager ? 1 : 0
  secret  = "renderer-shared-secret"
  project = var.project_id

  depends_on = [google_project_service.secretmanager]
}

# Firebase configuration (public keys, stored in Secret Manager to keep out of repo)
data "google_secret_manager_secret_version" "firebase_api_key" {
  count   = var.use_secret_manager ? 1 : 0
  secret  = "firebase-api-key"
  project = var.project_id

  depends_on = [google_project_service.secretmanager]
}

data "google_secret_manager_secret_version" "firebase_auth_domain" {
  count   = var.use_secret_manager ? 1 : 0
  secret  = "firebase-auth-domain"
  project = var.project_id

  depends_on = [google_project_service.secretmanager]
}

data "google_secret_manager_secret_version" "firebase_project_id" {
  count   = var.use_secret_manager ? 1 : 0
  secret  = "firebase-project-id"
  project = var.project_id

  depends_on = [google_project_service.secretmanager]
}

data "google_secret_manager_secret_version" "firebase_storage_bucket" {
  count   = var.use_secret_manager ? 1 : 0
  secret  = "firebase-storage-bucket"
  project = var.project_id

  depends_on = [google_project_service.secretmanager]
}

data "google_secret_manager_secret_version" "firebase_messaging_sender_id" {
  count   = var.use_secret_manager ? 1 : 0
  secret  = "firebase-messaging-sender-id"
  project = var.project_id

  depends_on = [google_project_service.secretmanager]
}

data "google_secret_manager_secret_version" "firebase_app_id" {
  count   = var.use_secret_manager ? 1 : 0
  secret  = "firebase-app-id"
  project = var.project_id

  depends_on = [google_project_service.secretmanager]
}

# Local values for secrets (uses Secret Manager or falls back to variables)
locals {
  gemini_api_key = var.use_secret_manager ? (
    length(data.google_secret_manager_secret_version.gemini_api_key) > 0 
    ? data.google_secret_manager_secret_version.gemini_api_key[0].secret_data 
    : ""
  ) : var.gemini_api_key

  stripe_secret_key = var.use_secret_manager && var.enable_billing ? (
    length(data.google_secret_manager_secret_version.stripe_secret_key) > 0 
    ? data.google_secret_manager_secret_version.stripe_secret_key[0].secret_data 
    : ""
  ) : var.stripe_secret_key

  replicate_api_token = var.use_secret_manager && var.enable_video_effects ? (
    length(data.google_secret_manager_secret_version.replicate_api_token) > 0 
    ? data.google_secret_manager_secret_version.replicate_api_token[0].secret_data 
    : ""
  ) : var.replicate_api_token

  algolia_admin_key = var.use_secret_manager && var.enable_algolia ? (
    length(data.google_secret_manager_secret_version.algolia_admin_key) > 0
    ? data.google_secret_manager_secret_version.algolia_admin_key[0].secret_data
    : ""
  ) : var.algolia_admin_key

  asset_service_shared_secret = var.use_secret_manager ? (
    length(data.google_secret_manager_secret_version.asset_service_shared_secret) > 0
    ? data.google_secret_manager_secret_version.asset_service_shared_secret[0].secret_data
    : ""
  ) : var.asset_service_shared_secret

  renderer_shared_secret = var.use_secret_manager ? (
    length(data.google_secret_manager_secret_version.renderer_shared_secret) > 0
    ? data.google_secret_manager_secret_version.renderer_shared_secret[0].secret_data
    : ""
  ) : var.renderer_shared_secret
}
