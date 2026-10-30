#!/usr/bin/env bash
# Calibration of the deployed ST-GCN on the GPU node, using the deployed
# pipeline end to end (OpenPose via the running ML server, then the server's
# own preprocessing in predict_dataset.py).
#
#   bash run_calibration.sh extract    # videos -> keypoints via POST /subjects/extract (idempotent)
#   bash run_calibration.sh manifest   # manifest.csv + splits.json (subject-level, seed 42)
#   bash run_calibration.sh predict    # preds.csv (val + test) inside the ML image, GPU
#   bash run_calibration.sh calibrate  # calibration.json (--score-level sample)
#   bash run_calibration.sh evaluate   # test_results.json (ONCE)
#   bash run_calibration.sh all
set -euo pipefail

ASDR="$HOME/Luan_workspace/asdr"
DATA="$ASDR/ml/datasets/Dataset_video"
WORK="$ASDR/ml/calibration"
RS="$ASDR/ml/research_src"
CKPT="$ASDR/ml/checkpoints/finetuned_best_model.pth"
IMAGE="openpose-api:rtx5060ti-v2"
ML_URL="http://127.0.0.1:8000"
KEY="$(grep '^ML_API_KEY=' "$ASDR/.env" | cut -d= -f2-)"
SEED=42

step="${1:-all}"

# The host has no numpy: every python step runs inside the ML image, with the
# asdr folder mounted at the same absolute path so file paths stay valid.
cpy() {
  docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -e MPLCONFIGDIR=/tmp \
    -v "$HOME/Luan_workspace/asdr:$HOME/Luan_workspace/asdr" -w "$RS" "$IMAGE" python3 "$@"
}

do_extract() {
  local log="$WORK/extract.log"
  echo "== extract -> $log"
  for cls in Autism Typical; do
    for v in "$DATA/$cls"/*; do
      [ -f "$v" ] || continue
      stem="$(basename "${v%.*}")"
      sid="calib-${cls}-${stem}"
      out="$ASDR/ml/storage/asd_subjects/$sid/keypoints_body25.json"
      if [ -s "$out" ]; then echo "skip $sid (exists)" >> "$log"; continue; fi
      t0=$(date +%s)
      code=$(curl -s -m 1800 -o "$WORK/.last_extract.json" -w "%{http_code}" \
        -H "X-API-Key: $KEY" -F "video=@$v" "$ML_URL/subjects/extract?subject_id=$sid" || echo "curl-fail")
      echo "$(date +%T) $sid http=$code $(( $(date +%s) - t0 ))s $(head -c 160 "$WORK/.last_extract.json" | tr -d '\n')" >> "$log"
      if [ "$code" != "200" ]; then echo "FAILED $sid http=$code" >&2; fi
    done
  done
  echo "extracted: $(ls -d "$ASDR"/ml/storage/asd_subjects/calib-*/ 2>/dev/null | wc -l) subjects; failures: $(grep -c 'http=[^2]' "$log" || true)"
}

do_manifest() {
  echo "== manifest + split"
  {
    echo "path,subject_id,label"
    for cls in Autism Typical; do
      label=0; [ "$cls" = "Autism" ] && label=1
      for d in "$ASDR"/ml/storage/asd_subjects/calib-${cls}-*/; do
        kp="$d/keypoints_body25.json"; [ -s "$kp" ] || continue
        sid="$(basename "$d")"; stem="${sid#calib-${cls}-}"
        # same subject ids the original split produced from Dataset_video/<cls>/video_N.xlsx
        echo "../storage/asd_subjects/$sid/keypoints_body25.json,$cls/$stem,$label"
      done
    done
  } > "$WORK/manifest.csv"
  echo "manifest rows: $(( $(wc -l < "$WORK/manifest.csv") - 1 ))"
  cpy "$RS/calibrate_evaluate.py" split --manifest "$WORK/manifest.csv" --seed "$SEED" --dry-run
  cpy "$RS/calibrate_evaluate.py" split --manifest "$WORK/manifest.csv" --seed "$SEED" --output "$WORK/splits.json"
}

do_predict() {
  echo "== predict (val + test) in $IMAGE"
  # Same absolute path inside the container, so splits.json paths stay valid.
  docker run --rm --gpus all --user "$(id -u):$(id -g)" -e HOME=/tmp -e MPLCONFIGDIR=/tmp \
    -v "$HOME/Luan_workspace/asdr:$HOME/Luan_workspace/asdr" \
    -w "$RS" \
    "$IMAGE" python3 predict_dataset.py \
      --checkpoint "$CKPT" --splits "$WORK/splits.json" --only-splits val test \
      --api-dir "$ASDR/ml/server" --device cuda --output "$WORK/preds.csv"
  echo "rows: $(wc -l < "$WORK/preds.csv")  errors: $(awk -F, 'NR>1 && $NF!=""' "$WORK/preds.csv" | wc -l)"
}

do_calibrate() {
  echo "== calibrate (sample level)"
  cpy "$RS/calibrate_evaluate.py" calibrate --predictions "$WORK/preds.csv" \
    --checkpoint "$CKPT" --score-level sample --output "$WORK/calibration.json"
}

do_evaluate() {
  echo "== evaluate test ONCE"
  cpy "$RS/calibrate_evaluate.py" evaluate --predictions "$WORK/preds.csv" \
    --calibration "$WORK/calibration.json" --checkpoint "$CKPT" --output "$WORK/test_results.json"
}

case "$step" in
  extract) do_extract ;;
  manifest) do_manifest ;;
  predict) do_predict ;;
  calibrate) do_calibrate ;;
  evaluate) do_evaluate ;;
  all) do_extract; do_manifest; do_predict; do_calibrate; do_evaluate ;;
  *) echo "unknown step $step" >&2; exit 2 ;;
esac
