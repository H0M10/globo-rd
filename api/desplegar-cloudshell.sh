#!/usr/bin/env bash
# Crea (o actualiza) la API del Globo RDS en AWS Lambda.
# Se ejecuta en AWS CloudShell (región us-east-1) junto con function.zip:
#   bash desplegar-cloudshell.sh
set -euo pipefail

REGION=us-east-1
FUNCION=globo-rds-api
ROL=globo-rds-lambda-rol
ZIP=function.zip
VARIABLES="Variables={PGHOST=bd-expo-postgres.csbkuqa2mmop.us-east-1.rds.amazonaws.com,PGPORT=5432,PGDATABASE=escuela,PGUSER=globo_app,PGPASSWORD=CAMBIA_ESTA_CONTRASENA,ADMIN_KEY=expo-rds-2026,ALLOWED_ORIGIN=https://h0m10.github.io}"

cd "$(dirname "$0")"
[ -f "$ZIP" ] || { echo "No encuentro $ZIP. Súbelo con Acciones > Cargar archivo."; exit 1; }

echo "1/5 Rol de permisos para la Lambda..."
if ! aws iam get-role --role-name "$ROL" >/dev/null 2>&1; then
  aws iam create-role --role-name "$ROL" --assume-role-policy-document \
    '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null
  aws iam attach-role-policy --role-name "$ROL" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
  echo "    Rol creado. Esperando 10 s a que IAM lo propague..."
  sleep 10
fi
ARN_ROL=$(aws iam get-role --role-name "$ROL" --query Role.Arn --output text)

echo "2/5 Función Lambda..."
if aws lambda get-function --function-name "$FUNCION" --region "$REGION" >/dev/null 2>&1; then
  aws lambda update-function-code --function-name "$FUNCION" --zip-file "fileb://$ZIP" --region "$REGION" >/dev/null
  aws lambda wait function-updated-v2 --function-name "$FUNCION" --region "$REGION"
  aws lambda update-function-configuration --function-name "$FUNCION" --region "$REGION" \
    --environment "$VARIABLES" --timeout 10 --memory-size 256 >/dev/null
  echo "    Función actualizada."
else
  for intento in 1 2 3 4 5 6; do
    if aws lambda create-function --function-name "$FUNCION" --region "$REGION" \
        --runtime nodejs22.x --architectures arm64 --handler index.handler \
        --role "$ARN_ROL" --zip-file "fileb://$ZIP" \
        --timeout 10 --memory-size 256 --environment "$VARIABLES" >/dev/null 2>/tmp/error-lambda; then
      echo "    Función creada."
      break
    fi
    if [ "$intento" -eq 6 ]; then cat /tmp/error-lambda; exit 1; fi
    echo "    El rol aún no está listo; reintento en 8 s..."
    sleep 8
  done
fi
aws lambda wait function-active-v2 --function-name "$FUNCION" --region "$REGION"
aws lambda wait function-updated-v2 --function-name "$FUNCION" --region "$REGION"

echo "3/5 URL pública de la función..."
if ! aws lambda get-function-url-config --function-name "$FUNCION" --region "$REGION" >/dev/null 2>&1; then
  aws lambda create-function-url-config --function-name "$FUNCION" --auth-type NONE --region "$REGION" >/dev/null
fi
URL=$(aws lambda get-function-url-config --function-name "$FUNCION" --region "$REGION" --query FunctionUrl --output text)

echo "4/5 Permiso para que cualquiera pueda llamar a la URL..."
aws lambda add-permission --function-name "$FUNCION" --region "$REGION" \
  --statement-id url-publica --action lambda:InvokeFunctionUrl \
  --principal "*" --function-url-auth-type NONE >/dev/null 2>&1 || true
aws lambda add-permission --function-name "$FUNCION" --region "$REGION" \
  --statement-id url-publica-invocar --action lambda:InvokeFunction \
  --principal "*" --invoked-via-function-url >/dev/null 2>&1 || true

echo "5/5 Probando la API (la primera vez tarda un poco)..."
sleep 3
RESPUESTA=$(curl -s --max-time 25 "${URL}salud" || true)
echo "    ${URL}salud → $RESPUESTA"

echo
if echo "$RESPUESTA" | grep -q '"ok":true'; then
  echo "LISTO. Copia esta URL y pásasela a Claude:"
else
  echo "La función se creó, pero la prueba no respondió ok. Copia todo lo de arriba y pásaselo a Claude."
fi
echo
echo "    $URL"
echo
