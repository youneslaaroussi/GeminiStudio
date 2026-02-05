# GeminiStudio Terraform Outputs

output "instance_name" {
  description = "Name of the created GCE instance"
  value       = google_compute_instance.gemini_studio.name
}

output "instance_external_ip" {
  description = "External IP address of the VM"
  value       = google_compute_address.gemini_studio.address
}

output "ssh_command" {
  description = "SSH command to connect to the VM"
  value       = "gcloud compute ssh ${google_compute_instance.gemini_studio.name} --zone=${var.zone} --project=${var.project_id}"
}

output "public_url" {
  description = "Public URL for the application"
  value       = "https://geminivideo.studio"
}

output "architecture_note" {
  description = "Architecture overview"
  value       = <<-EOT
    
    Network Architecture:
    - Public: Caddy reverse proxy (ports 80/443) at https://geminivideo.studio
    - Internal only (via Docker network):
      - Frontend (Next.js) on port 3000
      - Asset Service on port 8081
      - Video Effects on port 8082
      - LangGraph on port 8080
      - Renderer on port 4000
      - Billing on port 3100
      - Redis on port 6379
    
  EOT
}

output "gcs_bucket" {
  description = "GCS bucket name"
  value       = var.gcs_bucket_name
}

output "next_steps" {
  description = "Next steps after terraform apply"
  value       = <<-EOT
    
    Infrastructure created! Next steps:
    
    1. Copy deploy/.env to VM (create from deploy/.env.example, all vars come from docker-compose + .env):
       gcloud compute scp deploy/.env ${google_compute_instance.gemini_studio.name}:/opt/gemini-studio/deploy/.env --zone=${var.zone} --project=${var.project_id}
    
    2. Copy service account JSON to VM:
       gcloud compute scp /path/to/service-account.json ${google_compute_instance.gemini_studio.name}:/opt/gemini-studio/deploy/secrets/service-account.json --zone=${var.zone} --project=${var.project_id}
    
    3. Add GitHub secret for CI/CD:
       - Go to: https://github.com/<your-repo>/settings/secrets/actions
       - Create secret: GCP_SERVICE_ACCOUNT_KEY
       - Value: contents of your service account JSON file
    
    4. Push to main branch to trigger deployment:
       git push origin main
    
    5. Point your domain (geminivideo.studio) to: ${google_compute_address.gemini_studio.address}
    
  EOT
}
