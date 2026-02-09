# GeminiStudio Terraform Variables
# Secrets and env vars are managed via deploy/.env and docker-compose - Terraform only manages infrastructure.

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
  description = "GCE machine type"
  type        = string
  default     = "e2-standard-8"
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

variable "cloudflare_ip_ranges" {
  description = "Cloudflare IPv4/IPv6 CIDR blocks allowed to reach the origin (update if Cloudflare publishes new ranges)."
  type        = list(string)
  default = [
    # IPv4 ranges
    "173.245.48.0/20",
    "103.21.244.0/22",
    "103.22.200.0/22",
    "103.31.4.0/22",
    "141.101.64.0/18",
    "108.162.192.0/18",
    "190.93.240.0/20",
    "188.114.96.0/20",
    "197.234.240.0/22",
    "198.41.128.0/17",
    "162.158.0.0/15",
    "104.16.0.0/13",
    "104.24.0.0/14",
    "172.64.0.0/13",
    "131.0.72.0/22",

    # IPv6 ranges
    "2400:cb00::/32",
    "2606:4700::/32",
    "2803:f800::/32",
    "2405:b500::/32",
    "2405:8100::/32",
    "2a06:98c0::/29",
    "2c0f:f248::/32",
  ]
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
