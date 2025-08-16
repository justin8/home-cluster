# Immich

Immich's recommended installation method is via [Docker Compose](https://immich.app/docs/install/docker-compose). There is an official Helm chart, but it isn't great; it has a lot of complexity added via templates and won't play nice with some of their PVC setup and what not. Due to this, I've taken what they're doing in compose and combined with the [docs on environment variables](https://immich.app/docs/install/environment-variables/) and a lot of trial and error, turned it in to a Kubernetes manifest.

## Updates

Updates are not automated yet, and immich has breaking changes occasionally, so versions are pinned. When doing an update, run `./compose-source/update.sh` and view the git diff between the last installed version and the current one. Also make sure to check the [Github releases page](https://github.com/immich-app/immich/releases) for any information about breaking changes in recent versions.
