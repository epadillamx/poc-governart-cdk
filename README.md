# PoC Gobernanza de Datos

CDK Node.js (TypeScript) que despliega una arquitectura mínima de gobernanza de datos en AWS:

- **S3** raw zone (ingesta manual de CSV)
- **AWS Glue Catalog** (database + crawler)
- **AWS Glue Data Quality** (ruleset)
- **AWS Lake Formation** (location + permisos finos)
- **Amazon Macie** (clasificación de PII)
- **Amazon DataZone** (dominio + proyecto)
- **Linaje** vía OpenLineage → DataZone

> Plan completo y decisiones de diseño: [.claude/plan/poc-gobernanza-datos.md](.claude/plan/poc-gobernanza-datos.md).

---

## Quick start

### 1. Pre-requisitos manuales en la consola AWS

**Antes de cualquier comando**, completar los pasos de la sección §7 del plan:

- §7.3 — Identificar el ARN del rol de despliegue.
- §7.4 — **Lake Formation: registrarse como Data Lake Administrator** (crítico).
- §7.5 — Verificar estado de Macie (si ya está habilitado, setear `ENABLE_MACIE=false`).
- §7.6 — Verificar región DataZone.
- §7.8 — `cdk bootstrap` y añadir el `cfn-exec-role` también como LF admin.

Checklist completo en §7.10 del plan.

### 2. Variables de entorno

```bash
cp .env.example .env
# editar .env y completar AWS_PROFILE, AWS_REGION, STAGE, PROJECT_NAME,
# CDK_DEFAULT_ACCOUNT, CDK_EXEC_ROLE_ARN
```

Cargar en la sesión:

```bash
# bash / zsh
set -a && source .env && set +a

# PowerShell
Get-Content .env | % { if ($_ -match '^([^#=]+)=(.*)$') { Set-Item "Env:$($matches[1])" $matches[2] } }
```

### 3. Instalar y validar

```bash
npm install
npm run synth
```

### 4. Desplegar

```bash
npm run bootstrap   # lee account/region/profile desde .env
npm run deploy
```

### 5. Validación end-to-end

1. Subir el CSV de muestra:
   ```bash
   aws s3 cp assets/clientes.sample.csv s3://<RawBucketName>/clientes/clientes.csv --profile $AWS_PROFILE
   ```
2. Ejecutar el crawler en consola Glue → verificar tabla `clientes` en `<GlueDatabaseName>`.
3. Ejecutar el ruleset DQ desde consola Glue → revisar resultados.
4. Verificar el classification job de Macie y sus findings.
5. En DataZone: dominio → proyecto → "Add data" → seleccionar la tabla → publicar.
6. Emitir linaje:
   ```bash
   npm run emit-lineage -- <DataZoneDomainId> <RawBucketName> <GlueDatabaseName>
   ```
7. Pestaña *Lineage* del asset en DataZone → confirmar grafo.

### 6. Limpieza

```bash
npm run destroy
# DataZone domain debe limpiarse manualmente desde consola si no se borra automáticamente.
```

---

## Estructura

```
.
├── bin/app.ts                    # Entry point CDK
├── lib/
│   ├── governance-stack.ts       # Stack único
│   └── constructs/
│       ├── storage.ts
│       ├── glue-catalog.ts
│       ├── lake-formation.ts
│       ├── glue-dq.ts
│       ├── macie.ts
│       ├── datazone.ts
│       └── lineage.ts
├── scripts/emit-lineage.ts       # Emisor OpenLineage manual
├── assets/clientes.sample.csv    # CSV de prueba con PII
├── .env.example
└── .claude/plan/poc-gobernanza-datos.md
```

## Variables `.env` relevantes

| Variable | Obligatorio | Descripción |
|---|---|---|
| `AWS_PROFILE` | sí | Perfil AWS CLI |
| `AWS_REGION` | sí | Region (recomendado `us-east-1`) |
| `STAGE` | sí | `dev` / `qa` / `prod` |
| `PROJECT_NAME` | sí | Prefijo de recursos |
| `CDK_DEFAULT_ACCOUNT` | sí | Account ID destino |
| `CDK_EXEC_ROLE_ARN` | recomendado | ARN del rol que ejecuta `cdk deploy` |
| `DATA_ANALYST_ROLE_ARN` | opcional | Rol existente para SELECT vía LF |
| `ENABLE_MACIE` | opcional | `false` si Macie ya está habilitado en la cuenta |
| `MANAGE_LF_ADMINS` | opcional | `true` para que CDK gestione admins LF (peligroso, ver §11) |
