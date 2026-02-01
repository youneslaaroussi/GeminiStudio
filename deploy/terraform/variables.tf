# GeminiStudio Terraform Variables

# =============================================================================
# Required Variables
# =============================================================================

variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "gcs_bucket_name" {
  description = "GCS bucket name for assets (must exist or set create_gcs_bucket=true)"
  type        = string
}

# =============================================================================
# Infrastructure Configuration
# =============================================================================

variable "region" {
  description = "GCP region"
  type        = string
  default     = "us-central1"
}

variable "zone" {
  description = "GCP zone"
  type        = string
  default     = "us-central1-a"
}

variable "instance_name" {
  description = "Name of the GCE instance"
  type        = string
  default     = "gemini-studio"
}

variable "machine_type" {
  description = "GCE machine type (e2-standard-2 = 2 vCPU, 8GB RAM)"
  type        = string
  default     = "e2-standard-2"
}

variable "disk_size_gb" {
  description = "Boot disk size in GB"
  type        = number
  default     = 50
}

variable "service_account_email" {
  description = "Service account email (leave empty for default compute SA)"
  type        = string
  default     = ""
}

# =============================================================================
# Secret Manager Configuration
# =============================================================================

variable "use_secret_manager" {
  description = "Use Google Secret Manager for API keys (recommended)"
  type        = bool
  default     = true
}

# Fallback variables if not using Secret Manager
variable "gemini_api_key" {
  description = "Gemini API key (only used if use_secret_manager=false)"
  type        = string
  default     = ""
  sensitive   = true
}

variable "stripe_secret_key" {
  description = "Stripe secret key (only used if use_secret_manager=false)"
  type        = string
  default     = ""
  sensitive   = true
}

variable "replicate_api_token" {
  description = "Replicate API token (only used if use_secret_manager=false)"
  type        = string
  default     = ""
  sensitive   = true
}

variable "algolia_admin_key" {
  description = "Algolia Admin API key (only used if use_secret_manager=false)"
  type        = string
  default     = ""
  sensitive   = true
}

# =============================================================================
# Feature Flags
# =============================================================================

variable "enable_billing" {
  description = "Enable billing service (requires Stripe)"
  type        = bool
  default     = false
}

variable "enable_video_effects" {
  description = "Enable video effects service (requires Replicate)"
  type        = bool
  default     = false
}

variable "enable_algolia" {
  description = "Enable Algolia search"
  type        = bool
  default     = false
}

# =============================================================================
# Service Configuration
# =============================================================================

variable "gemini_model_id" {
  description = "Gemini model ID for asset analysis"
  type        = string
  default     = "gemini-2.0-flash"
}

variable "veo_location" {
  description = "Vertex AI location for Veo"
  type        = string
  default     = "us-central1"
}

variable "veo_model_id" {
  description = "Veo model ID"
  type        = string
  default     = "veo-3.0-generate-001"
}

variable "speech_location" {
  description = "Speech-to-Text location"
  type        = string
  default     = "global"
}

variable "speech_model" {
  description = "Speech-to-Text model"
  type        = string
  default     = "chirp_3"
}

variable "speech_language_codes" {
  description = "Speech-to-Text language codes"
  type        = string
  default     = "en-US"
}

variable "renderer_concurrency" {
  description = "Number of concurrent render jobs"
  type        = number
  default     = 2
}

variable "frontend_url" {
  description = "Frontend URL for CORS (e.g., https://your-app.vercel.app)"
  type        = string
  default     = "http://localhost:3000"
}

# =============================================================================
# Algolia Configuration
# =============================================================================

variable "algolia_app_id" {
  description = "Algolia Application ID"
  type        = string
  default     = ""
}

variable "algolia_index_prefix" {
  description = "Algolia index prefix"
  type        = string
  default     = "gemini_assets"
}

# =============================================================================
# Optional Resource Creation
# =============================================================================

variable "create_gcs_bucket" {
  description = "Create a new GCS bucket (set false if bucket already exists)"
  type        = bool
  default     = false
}

variable "create_pubsub_topics" {
  description = "Create Pub/Sub topics"
  type        = bool
  default     = true
}
