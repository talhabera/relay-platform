#!/bin/bash
set -e

# Usage:
#   IMAGE_TAG=latest  ./docker-scripts.sh build     Build all images locally; do not push.
#   IMAGE_TAG=preprod ./docker-scripts.sh publish   Build all images and push to the registry.
#
# IMAGE_TAG is REQUIRED and has no default, matching docker-compose.yml. Prod
# (branch `main`) uses `latest`; preprod (branch `preprod`) uses `preprod`.
#
# The two stacks share one VPS and one Docker daemon, so a default here would be
# actively dangerous: running `publish` from the preprod branch with an implicit
# `:latest` builds preprod source straight over the images prod is running.
# Never give IMAGE_TAG a default, and never hardcode a tag below.
#
# Push target: registry.example.com. Run `docker login registry.example.com`
# once before `publish` if you haven't authenticated this machine yet.

CMD="${1:-}"

case "$CMD" in
  build|publish) ;;
  *)
    echo "Usage: IMAGE_TAG={latest|preprod} $0 {build|publish}"
    echo "  build    Build all service images locally without pushing"
    echo "  publish  Build and push all service images to the registry"
    exit 1
    ;;
esac

if [ -z "${IMAGE_TAG:-}" ]; then
  echo "ERROR: IMAGE_TAG is not set." >&2
  echo "  Set it explicitly — there is no default, on purpose:" >&2
  echo "    IMAGE_TAG=latest   for prod    (branch main)" >&2
  echo "    IMAGE_TAG=preprod  for preprod (branch preprod)" >&2
  echo "  Publishing preprod source to :latest overwrites prod's images." >&2
  exit 1
fi

REGISTRY="registry.example.com"

# Guard the one mistake that costs real money: publishing the preprod branch
# over prod's :latest images. Warn loudly and require confirmation when the
# checked-out branch and the requested tag disagree.
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
if [ "$CMD" = "publish" ] && [ "$IMAGE_TAG" = "latest" ] && [ "$BRANCH" != "main" ]; then
  echo "REFUSING: publishing :latest from branch '$BRANCH', not 'main'." >&2
  echo "  :latest is what prod runs. Publishing it from a non-main branch" >&2
  echo "  overwrites the images prod is serving." >&2
  echo "  If this is genuinely intended, re-run with ALLOW_OFF_BRANCH_LATEST=1." >&2
  [ "${ALLOW_OFF_BRANCH_LATEST:-}" = "1" ] || exit 1
  echo "  ALLOW_OFF_BRANCH_LATEST=1 set — proceeding anyway." >&2
fi

echo "==> registry=$REGISTRY tag=$IMAGE_TAG branch=$BRANCH cmd=$CMD"

build_and_maybe_push() {
  local name="$1"
  local dockerfile="$2"
  local image="$3"
  local tag="$REGISTRY/$image:$IMAGE_TAG"

  echo "==> [$name] build $tag"
  docker build -f "$dockerfile" -t "$tag" .

  if [ "$CMD" = "publish" ]; then
    echo "==> [$name] push $tag"
    docker push "$tag"
  fi
}

build_and_maybe_push worker packages/worker/Dockerfile relay-worker
build_and_maybe_push web    apps/web/Dockerfile       relay-web

echo "All $CMD steps completed."
