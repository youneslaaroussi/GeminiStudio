# CircleCI deploy (GCE)

This directory configures **CircleCI** to deploy to your GCE VM on pushes to `main`, replacing the GitHub Actions workflow in `.github/workflows/deploy.yml`.

## 1. Configure in CircleCI (not in GitHub)

1. **Add the project in CircleCI**
   - Go to [circleci.com](https://circleci.com) and sign in with **GitHub**.
   - Click **Projects** → **Add Projects** → find **GeminiStudio** (or your repo name) → **Set Up Project**.
   - CircleCI will use the config in `.circleci/config.yml`; no need to add anything in GitHub for the pipeline itself.

2. **Set the GCP secret in CircleCI**
   - In the CircleCI project: **Project Settings** → **Environment Variables**.
   - Add:
     - **Name:** `GCP_SERVICE_ACCOUNT_KEY`
     - **Value:** the **entire** JSON content of your GCP service account key (same as `GCP_SERVICE_ACCOUNT_KEY` in GitHub Actions secrets).
   - For multiline JSON, paste the whole key; if your org requires it, you can base64‑encode and decode in the job (we can add that if needed).

3. **Optional: manual runs**
   - **Trigger pipeline:** In CircleCI, **Pipelines** → **Trigger Pipeline** → choose branch `main` to run deploy without pushing.
   - **Rerun:** Any past pipeline can be **Rerun workflow from start** from the job page.

## 2. Optional: GitHub-side changes

- **Stop using GitHub Actions for deploy:**  
  To avoid running both CI systems, you can **delete** or **disable** `.github/workflows/deploy.yml` (e.g. rename to `deploy.yml.disabled` or remove the file). Deploy will then only run on CircleCI.

- **No extra GitHub config needed for CircleCI:**  
  Connecting the repo to CircleCI (step 1) is done in CircleCI’s UI with “Sign in with GitHub”. CircleCI will use GitHub’s API and webhooks; you don’t need to add a GitHub Action or repo setting for CircleCI.

## 3. Summary

| What | Where |
|------|--------|
| Pipeline definition | `.circleci/config.yml` (this repo) |
| Add project & connect GitHub | CircleCI dashboard (circleci.com) |
| Secret `GCP_SERVICE_ACCOUNT_KEY` | CircleCI Project Settings → Environment Variables |
| Disable old deploy | Optional: remove/rename `.github/workflows/deploy.yml` |

After this, every push to `main` will run the deploy job on CircleCI and deploy to your GCE VM.
