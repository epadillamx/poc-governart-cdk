# Plan PoC – Gobernanza de Datos en AWS (CDK Node.js / TypeScript)

## 1. Objetivo

Implementar, con **AWS CDK en Node.js (TypeScript)**, una PoC mínima pero funcional de gobernanza de datos sobre AWS que integre:

- **Amazon S3** como zona de aterrizaje (ingesta manual de CSV).
- **AWS Glue Catalog** como catálogo técnico.
- **AWS Glue Data Quality** para reglas de calidad sobre la tabla.
- **AWS Lake Formation** para permisos finos sobre el catálogo.
- **Amazon Macie** para descubrimiento de datos sensibles (PII).
- **Amazon DataZone** como catálogo de negocio / publicación de activos **y como motor de linaje**.
- **Linaje de datos** capturado y visualizado en DataZone (origen S3 → tabla Glue → consumo).

**Principio rector:** lo más simple posible. Una sola tabla, un solo CSV, un único stack desplegable, recursos por defecto donde sea posible.

---

## 2. Alcance funcional (flujo end-to-end)

1. El usuario sube **manualmente** un `clientes.csv` al bucket S3 *raw*.
2. Un **Glue Crawler** descubre el esquema y registra la tabla en **Glue Catalog**.
3. **Lake Formation** gobierna permisos sobre la base/tabla (modelo LF habilitado, no IAM-only).
4. **Glue Data Quality** ejecuta un *ruleset* básico sobre esa tabla.
5. **Macie** escanea el bucket *raw* en busca de PII y emite hallazgos.
6. **DataZone** expone la tabla del Glue Catalog como activo publicable en un dominio/proyecto.
7. **Linaje**: DataZone captura automáticamente el linaje del crawler/DQ (eventos OpenLineage) y lo muestra en la pestaña *Lineage* del activo; opcionalmente se inyectan eventos manuales para reflejar el upload del CSV.

---

## 3. Arquitectura lógica

```
[ Usuario ] --(upload CSV)--> [ S3: raw-bucket ]
                                    │
                                    ├──> [ Macie classification job ]  --> Findings (PII)
                                    │
                                    ▼
                             [ Glue Crawler ]
                                    │
                                    ▼
                          [ Glue Database + Table ]
                                    │           │
                                    │           └──> [ Glue Data Quality Ruleset / Run ]
                                    │
                                    ▼
                          [ Lake Formation ]  (registro de location + permisos)
                                    │
                                    ▼
                          [ DataZone Domain ]
                                    └──> Project + Environment (DefaultDataLake blueprint)
                                                    ├──> Asset publicado desde Glue Catalog
                                                    └──> [ Lineage tab ]
                                                            ▲
                                                            │ OpenLineage events
                                                            │ (PostLineageEvent API)
                                              [ Glue Crawler / DQ runs ]
                                              [ Productor manual: upload CSV ]
```

---

## 4. Estructura del proyecto CDK

```
POC_Gobernanza/
├── bin/
│   └── app.ts                       # Entry point CDK
├── lib/
│   ├── governance-stack.ts          # Stack único (PoC)
│   └── constructs/
│       ├── storage.ts               # S3 raw bucket (+ KMS opcional)
│       ├── lake-formation.ts        # Settings LF + registro de location + permisos
│       ├── glue-catalog.ts          # DB + Crawler + IAM role Glue
│       ├── glue-dq.ts               # Ruleset de Data Quality
│       ├── macie.ts                 # Macie session + classification job
│       ├── datazone.ts              # Domain + Project + Environment
│       └── lineage.ts               # Helper para emitir eventos OpenLineage a DataZone
├── assets/
│   └── clientes.sample.csv          # CSV de ejemplo para validar
├── scripts/
│   └── emit-lineage.ts              # Emisor manual de eventos OpenLineage
├── .env.example                     # Plantilla de variables (commiteable)
├── .env                             # Valores reales (gitignored)
├── .gitignore
├── cdk.json
├── package.json
├── tsconfig.json
└── README.md
```

> Justificación: un solo stack mantiene la PoC simple. Los *constructs* separan responsabilidades sin fragmentar el despliegue.

---

## 5. Detalle por componente

### 5.1 S3 (`storage.ts`)
- **Bucket raw**: `poc-gov-raw-<account>-<region>`.
  - `blockPublicAccess: BLOCK_ALL`.
  - `encryption: S3_MANAGED` (SSE-S3) — simple para PoC.
  - `versioned: true` (requisito de Macie/LF en buenas prácticas).
  - Prefijo `clientes/` para la tabla.
- Sin notificaciones, sin lifecycle: ingesta manual.

### 5.2 Glue Catalog + Crawler (`glue-catalog.ts`)
- `CfnDatabase` → `poc_gov_db`.
- `Role` IAM para Glue con `AWSGlueServiceRole` + lectura sobre el bucket raw.
- `CfnCrawler`:
  - Target: `s3://<raw-bucket>/clientes/`.
  - Schedule: **on-demand** (se ejecuta manualmente para la PoC).
  - Database target: `poc_gov_db`.
  - Table prefix: vacío → tabla `clientes`.

### 5.3 Lake Formation (`lake-formation.ts`)
- `CfnDataLakeSettings`:
  - Definir el rol de despliegue (CDK exec role) como **DataLakeAdmin** para evitar bloqueos.
  - Mantener el modelo híbrido (no eliminar IAMAllowedPrincipals globalmente — simple para PoC).
- `CfnResource`: registrar la ubicación S3 (`s3://<raw-bucket>/`) usando `UseServiceLinkedRole: true`.
- `CfnPermissions` mínimo:
  - Conceder a un rol "data-analyst" de prueba `SELECT` sobre `poc_gov_db.clientes`.
  - Conceder al rol del Crawler `DATA_LOCATION_ACCESS` sobre la location registrada.

### 5.4 Glue Data Quality (`glue-dq.ts`)
- `CfnDataQualityRuleset` con DQDL básico, p. ej.:
  ```
  Rules = [
      RowCount > 0,
      IsComplete "id",
      IsUnique "id",
      ColumnExists "email"
  ]
  ```
- Asociado a `poc_gov_db.clientes`.
- Ejecución: **on-demand** (sin scheduler en PoC; se invoca por consola o CLI tras el crawler).

### 5.5 Macie (`macie.ts`)
- `CfnSession`: habilitar Macie con `findingPublishingFrequency: FIFTEEN_MINUTES`.
- `CfnClassificationJob`:
  - `jobType: ONE_TIME` (PoC; se vuelve a lanzar si hace falta).
  - `s3JobDefinition.bucketDefinitions`: bucket raw.
  - Sin custom data identifiers — usar los managed (suficiente para demo de PII).

### 5.6 DataZone (`datazone.ts`)
- `CfnDomain`: `poc-gov-domain`.
  - `domainExecutionRole`: rol nuevo con la *trust policy* y permisos mínimos documentados por AWS.
- Habilitar el blueprint **DefaultDataLake** (`CfnEnvironmentBlueprintConfiguration`) referenciando el rol del entorno.
- `CfnProject`: `poc-gov-project`.
- `CfnEnvironment`: ligado al blueprint DefaultDataLake → expone Glue Catalog del mismo account/region.
- **Publicación del activo**: se hará **manualmente desde la consola DataZone** tras el despliegue (la publicación de assets vía CFN/CDK aún tiene cobertura limitada; mantenerlo manual reduce complejidad y es coherente con "ingesta manual").
- **Linaje habilitado en el dominio**: al crear el `CfnDomain`, dejar la *data lineage* activa (es la opción por defecto en dominios nuevos desde 2024). No requiere recurso CFN adicional.

### 5.7 Linaje (`lineage.ts`)

DataZone tiene linaje **nativo**: una vez publicado el asset Glue, en la pestaña *Lineage* del activo aparece automáticamente el grafo aguas-arriba/abajo cuando llegan eventos **OpenLineage** al endpoint `PostLineageEvent` del dominio.

**Fuentes de linaje en esta PoC:**

1. **Automáticas (sin código):**
   - Ejecuciones del **Glue Crawler** y de **Glue Data Quality**: cuando el dominio DataZone tiene linaje habilitado y el Glue Catalog está enlazado al *environment*, DataZone correlaciona los runs con el asset y poblá nodos de tipo *job* en el grafo.
2. **Manual (script ligero):**
   - Un pequeño script Node.js (`scripts/emit-lineage.ts`) llama a `datazone:PostLineageEvent` con un evento OpenLineage que modela:
     - `inputs`: dataset `s3://<raw-bucket>/clientes/clientes.csv` (namespace `s3`).
     - `job`: `manual-csv-upload`.
     - `outputs`: tabla `poc_gov_db.clientes` (namespace `awsglue`).
   - Esto representa el paso "humano" (subida del CSV) que el catálogo no observa por sí solo.

**Implementación mínima:**
- `lineage.ts` (construct) **no crea recursos CFN** — solo expone el `domainId` y los nombres canónicos de dataset/job para que el script los use.
- Permisos: el rol que ejecute el script necesita `datazone:PostLineageEvent` sobre el dominio.
- Visualización: pestaña **Lineage** en el data asset publicado dentro del proyecto DataZone.

**Por qué OpenLineage y no una integración custom:** es el formato estándar que DataZone consume; reemplazarlo más adelante por un emisor de Airflow/Glue Spark Listener no requerirá rehacer la PoC.

---

## 6. Pasos de implementación (orden de ejecución)

1. **Bootstrap del proyecto**
   - `mkdir POC_Gobernanza && cd POC_Gobernanza`
   - `npx cdk init app --language typescript`
   - Instalar dependencias: `aws-cdk-lib`, `constructs` (ya vienen).
2. **Definir constants y contexto** en `cdk.json` (`accountId`, `region`, `rawBucketPrefix`).
3. **Implementar constructs en este orden** (cada uno compila y `cdk synth` antes del siguiente):
   1. `storage.ts` (S3).
   2. `glue-catalog.ts` (DB + role + crawler).
   3. `lake-formation.ts` (settings + location + permisos).
   4. `glue-dq.ts` (ruleset).
   5. `macie.ts` (session + job).
   6. `datazone.ts` (domain + project + environment).
4. **Componer en `governance-stack.ts`** y exponer outputs:
   - `RawBucketName`, `GlueDatabaseName`, `CrawlerName`, `DataZoneDomainId`, `DataZoneProjectId`.
5. **Despliegue**
   - `cdk bootstrap` (una vez por cuenta/región).
   - `cdk deploy --require-approval never`.
6. **Validación manual de la PoC**
   1. Subir `assets/clientes.sample.csv` a `s3://<raw-bucket>/clientes/`.
   2. Ejecutar el Crawler desde consola → verificar tabla `clientes`.
   3. Lanzar el Data Quality run sobre la tabla → revisar resultados.
   4. Confirmar que el Macie job aparece y produce findings (si el CSV contiene PII de ejemplo: email, teléfono).
   5. En DataZone: entrar al dominio → proyecto → environment → "Add data" → seleccionar la tabla del Glue Catalog → publicar.
   6. Buscar el asset desde el catálogo de DataZone.
   7. **Linaje**: ejecutar `npm run emit-lineage` (script `scripts/emit-lineage.ts`) → abrir el asset en DataZone → pestaña *Lineage* → confirmar nodos `s3://.../clientes.csv → manual-csv-upload → poc_gov_db.clientes` y los runs del crawler/DQ enlazados.

---

## 7. Pre-requisitos y pasos manuales antes del deploy

> **Importante:** ejecutar los pasos en este orden exacto. Saltarse el paso de Lake Formation es la causa #1 de despliegues fallidos en esta arquitectura.

### 7.1 Pre-requisitos generales

- Cuenta AWS con permisos de administrador para el rol que ejecuta `cdk deploy`.
- Region única (recomendado: `us-east-1` por madurez de DataZone/Macie).
- Node.js 20+, AWS CDK v2 (`npm i -g aws-cdk`).
- AWS CLI v2 instalado y configurado (`aws --version`).

### 7.2 Variables de entorno (`.env`)

Antes de cualquier comando CDK:

1. Copiar la plantilla: `cp .env.example .env`.
2. Completar al menos: `AWS_PROFILE`, `AWS_REGION`, `STAGE`, `PROJECT_NAME`, `CDK_DEFAULT_ACCOUNT`, `CDK_EXEC_ROLE_ARN`.
3. Cargar variables en la sesión: en Linux/macOS `set -a && source .env && set +a`; en PowerShell `Get-Content .env | % { if ($_ -match '^([^#=]+)=(.*)$') { Set-Item "Env:$($matches[1])" $matches[2] } }`.
4. Verificar: `aws sts get-caller-identity --profile $AWS_PROFILE` debe devolver el Account ID esperado.

### 7.3 Paso manual A — IAM: rol/credenciales de despliegue

**Consola:** IAM → Users (o Roles) → seleccionar el principal con el que vas a ejecutar `cdk deploy`.

1. Asegurar que tiene `AdministratorAccess` adjunto (PoC; en prod sería política mínima).
2. Si usas SSO/Identity Center: anota el ARN del **rol asumido** (no del usuario), porque ese es el `CDK_EXEC_ROLE_ARN` que registrarás como Data Lake Admin más adelante.
3. Comprobar el ARN exacto: `aws sts get-caller-identity --profile $AWS_PROFILE` → copiar el campo `Arn`. Ese es el ARN que va en `.env`.

### 7.4 Paso manual B — Lake Formation (CRÍTICO, hacer ANTES del primer deploy)

**Consola:** [https://console.aws.amazon.com/lakeformation](https://console.aws.amazon.com/lakeformation) en la región del PoC.

1. **Primer ingreso (first-time experience):** si la cuenta nunca usó LF, la consola muestra un wizard "Welcome to Lake Formation".
   - Marcar la casilla **"Add myself"** y también pegar el ARN del rol de despliegue del paso 7.3 si es distinto del usuario actual.
   - Click **Get started**. Esto crea la lista inicial de Data Lake Administrators y evita el bloqueo descrito en el §11.
2. **Si la cuenta ya tiene LF configurado:**
   - Menú izquierdo → **Administration → Administrative roles and tasks**.
   - En **Data lake administrators** → click **Choose administrators** → añadir el ARN del `CDK_EXEC_ROLE_ARN`. Guardar.
3. **Verificar el modo de defaults (no tocar si dudas):**
   - Misma página → sección **Database creators** y **Default permissions for newly created databases/tables**.
   - Para esta PoC, dejar el check **"Use only IAM access control for new databases / tables"** **activado** (mantiene `IAMAllowedPrincipals=Super` y conserva compatibilidad — ver §11.4).
4. **Captura del estado actual:** screenshot o anotar quién es admin antes de tocar nada — útil para revertir.

### 7.5 Paso manual C — Macie (verificación previa)

**Consola:** [https://console.aws.amazon.com/macie](https://console.aws.amazon.com/macie) en la región del PoC.

1. Si aparece el botón **"Get started → Enable Macie"**: Macie **no** está habilitado. El stack CDK lo activará — no hagas nada aquí, solo confírmalo.
2. Si entra directo al dashboard de findings: Macie **ya** está habilitado.
   - En `cdk.json` (o `.env`) ajustar `enableMacie=false` para que el construct **omita** la creación de `CfnSession` y solo cree el `CfnClassificationJob`.
   - Sin esto, CloudFormation falla con `Macie is already enabled for this account`.
3. Anotar la decisión.

### 7.6 Paso manual D — DataZone (verificación de región y dominio)

**Consola:** [https://console.aws.amazon.com/datazone](https://console.aws.amazon.com/datazone).

1. Verificar que la región seleccionada **soporta DataZone** (ver banner de la consola). Si no, cambiar `AWS_REGION` en `.env` a `us-east-1`.
2. **No crear el dominio manualmente** — el stack lo creará. Solo confirmar que no existe ya un dominio llamado `<PROJECT_NAME>-<STAGE>-domain` (si existe, renombrar `PROJECT_NAME` o borrarlo).
3. (Opcional) Si vas a invitar usuarios reales, habilitar **IAM Identity Center** en la región antes del deploy. Para PoC con un solo IAM user, no es necesario.

### 7.7 Paso manual E — Service-linked roles

La mayoría se crean automáticamente al primer uso, pero conviene chequear:

**Consola:** IAM → Roles → buscar:

- `AWSServiceRoleForLakeFormationDataAccess` → si no existe, lo crea LF al registrar la primera location.
- `AWSServiceRoleForAmazonMacie` → si no existe, lo crea Macie al habilitar la sesión.
- `AWSServiceRoleForAmazonDataZone` → idem para DataZone.

No requiere acción salvo que tengas SCPs (Service Control Policies) que bloqueen `iam:CreateServiceLinkedRole`. En ese caso, crearlos manualmente con `aws iam create-service-linked-role --aws-service-name lakeformation.amazonaws.com` antes del deploy.

### 7.8 Paso manual F — Bootstrap CDK (una vez por cuenta+región)

1. En terminal, con `.env` cargado:
   ```bash
   npx cdk bootstrap aws://$CDK_DEFAULT_ACCOUNT/$AWS_REGION --profile $AWS_PROFILE
   ```
2. Verificar en **CloudFormation** que existe el stack `CDKToolkit` en estado `CREATE_COMPLETE`.
3. **Anotar** el ARN del rol `cdk-hnb659fds-cfn-exec-role-...` que aparece en los outputs del CDKToolkit. **Ese rol también debe ser Data Lake Administrator** (volver al paso 7.4 y añadirlo si falta).

### 7.9 Paso manual G — Cuotas y costos (revisión)

**Consola:** Service Quotas + Billing.

1. **DataZone:** un dominio cuesta horas de uso aunque esté vacío (~USD 0.45/h). Para PoC corta, considerar destruir el stack al terminar.
2. **Macie:** se cobra por GB escaneado. Con un CSV pequeño es despreciable, pero confirma que no hay un classification job recurrente activo de antes.
3. **Glue Crawler:** USD 0.44/DPU-hora; un crawler manual no excede unos centavos.
4. Activar alertas de **AWS Budgets** con umbral USD 20 si es la primera vez.

### 7.10 Checklist final pre-deploy

Antes de ejecutar `cdk deploy`, confirmar uno por uno:

- [ ] `.env` creado, completado y cargado en la sesión actual.
- [ ] `aws sts get-caller-identity` devuelve el Account ID correcto.
- [ ] El ARN del rol de despliegue está registrado como **Data Lake Administrator** en la consola de Lake Formation.
- [ ] El ARN del rol `cdk-...-cfn-exec-role-...` (creado por el bootstrap) también es Data Lake Administrator.
- [ ] Estado de Macie en la cuenta documentado (`enableMacie=true|false` en context).
- [ ] La región soporta DataZone y no hay un dominio con el mismo nombre.
- [ ] `cdk bootstrap` ejecutado y `CDKToolkit` en `CREATE_COMPLETE`.
- [ ] `npx cdk synth` corre sin errores (validación local previa).

Solo cuando los 8 ítems estén marcados, proceder con el §6 paso 5 (`cdk deploy`).

---

## 8. Riesgos y mitigaciones (mínimos para PoC)

| Riesgo | Mitigación |
|---|---|
| Lake Formation bloquea al rol CDK al habilitar settings | Añadir el rol CDK como `DataLakeAdmin` en `CfnDataLakeSettings` antes de cualquier otro recurso LF |
| Macie ya activado en la cuenta | Detectar y omitir `CfnSession` (parámetro `enableMacie`) |
| DataZone domain costoso de borrar | Usar `RemovalPolicy.DESTROY` solo en bucket; documentar limpieza manual de DataZone |
| Crawler sin permisos sobre S3 registrado en LF | Conceder `DATA_LOCATION_ACCESS` al rol del crawler |

---

## 9. Criterios de aceptación

- `cdk deploy` finaliza sin errores en una cuenta limpia.
- Tras subir el CSV y correr el crawler, `poc_gov_db.clientes` aparece en Glue Catalog.
- El ruleset DQ se ejecuta y produce un resultado (pass/fail) visible en consola Glue.
- Macie genera al menos un `ClassificationJob` en estado `RUNNING`/`COMPLETE`.
- El dominio y proyecto de DataZone son visibles, y la tabla puede publicarse como asset.
- Un usuario con rol "data-analyst" puede consultar la tabla vía Athena gracias a los permisos LF.
- La pestaña *Lineage* del asset en DataZone muestra al menos el grafo `CSV → job manual → tabla Glue` después de ejecutar el script de linaje.

---

## 10. Fuera de alcance (deliberado, para mantener simplicidad)

- Pipelines automáticos de ingesta (Step Functions, EventBridge, Lambda).
- Zona *curated*/transformaciones Glue ETL.
- Custom Data Identifiers en Macie.
- Publicación automática de assets en DataZone vía API.
- Multi-cuenta / multi-region.
- KMS CMK propias (se usa SSE-S3).
- CI/CD del propio CDK.

Estos puntos quedan como extensiones naturales **post-PoC**.

---

## 11. Anexo: por qué Lake Formation puede "bloquear" al rol CDK

Es el *gotcha* clásico de empezar a usar Lake Formation en una cuenta donde antes todo se hacía con IAM puro. Conviene entenderlo antes de escribir el primer construct.

### 11.1 Cómo gobierna LF los permisos

Lake Formation **se interpone** entre los servicios de analítica (Glue, Athena, Redshift Spectrum, EMR…) y el Glue Data Catalog. Cuando un servicio quiere leer una tabla:

1. Primero IAM debe permitir la acción (p. ej. `glue:GetTable`).
2. **Además**, Lake Formation debe haber otorgado el permiso correspondiente (`SELECT`, `DESCRIBE`, `DATA_LOCATION_ACCESS`…) al *principal* IAM.

Si LF no ha otorgado nada, la consulta falla con `Insufficient Lake Formation permission(s)`, aunque el rol tenga `AdministratorAccess` en IAM. **IAM "abre la puerta" al servicio; LF "abre la puerta" a la fila/columna/tabla.**

### 11.2 De dónde sale el "bloqueo"

Hay tres palancas en `CfnDataLakeSettings` que, en combinación, generan el problema:

#### a) `Admins` **reemplaza**, no añade
La lista de `DataLakeAdmins` es **autoritativa**: lo que escribas en CFN sobrescribe la lista actual. Si el stack la define con un solo principal y olvidas incluir al rol que ejecuta `cdk deploy`, ese rol pierde la administración de LF en cuanto el cambio se aplique. Sin admin de LF, no puedes crear tablas, ni otorgar permisos, ni revertir el cambio desde el propio stack — y el siguiente `cdk deploy` falla porque ya no tienes permisos de LF para tocar nada.

#### b) `IAMAllowedPrincipals` y el "modo compatibilidad"
LF tiene un grupo virtual llamado **`IAMAllowedPrincipals`**. En cuentas nuevas, ese grupo recibe `Super` (todos los permisos) sobre cada base/tabla **por defecto**, lo cual hace que LF se comporte como si no estuviera y la autorización efectiva sea solo IAM.

Eso se controla con dos campos:
- `CreateDatabaseDefaultPermissions`
- `CreateTableDefaultPermissions`

Si los dejas en su valor por defecto, todas las nuevas DBs/tablas seguirán siendo "IAM-only" → LF no aporta nada. **Si los pones a `[]` (lista vacía) para "activar LF de verdad"**, cualquier tabla creada a partir de ese momento dejará de ser legible por roles que solo tenían permisos IAM, incluido el rol del crawler, el de Athena del analista o el de tu propio CDK. **Ese es el bloqueo más común.**

#### c) Registro de la location S3
`CfnResource` con `UseServiceLinkedRole: true` pone la ruta S3 bajo gobierno de LF. A partir de ahí, *cualquier* lectura/escritura sobre esa ruta hecha desde Glue/Athena requiere `DATA_LOCATION_ACCESS` otorgado por LF. Si registras la location pero no concedes `DATA_LOCATION_ACCESS` al rol del crawler, el crawler falla aunque su rol IAM tenga `s3:GetObject` sobre el bucket.

### 11.3 Cómo se manifiesta en CDK

Síntomas típicos durante un `cdk deploy`:

- `AccessDeniedException: User ... is not authorized to perform: lakeformation:PutDataLakeSettings`
  → El rol CDK fue removido de `Admins`.
- `InvalidInputException: Insufficient Lake Formation permission(s) on poc_gov_db`
  → El crawler intentó crear la tabla pero LF no le dio `CREATE_TABLE` sobre la base.
- En tiempo de uso: Athena devuelve `Insufficient Lake Formation permission(s)` al analista incluso con políticas IAM amplias.
  → El modo IAM-only se desactivó (default permissions vacíos) y nadie otorgó `SELECT`.

Suelen aparecer **a mitad del despliegue**, cuando algunos recursos ya existen, lo que dificulta el rollback.

### 11.4 Mitigación concreta para esta PoC

Orden estricto dentro del construct `lake-formation.ts`:

1. **Crear `CfnDataLakeSettings` lo primero**, con:
   - `admins`: incluye **siempre** el ARN del rol que ejecuta el deploy (CDK exec role / CloudFormation role) y, opcionalmente, el rol "data-analyst" para la PoC.
   - `createDatabaseDefaultPermissions` y `createTableDefaultPermissions`: **dejarlos por defecto** (no vaciarlos) → mantenemos `IAMAllowedPrincipals=Super`, conservando compatibilidad IAM. Es coherente con "lo más simple posible".
   - Esto evita los dos modos de fallo más comunes a la vez.
2. **Registrar la location S3** (`CfnResource`) con `useServiceLinkedRole: true`, **dependiente** del paso 1 (`addDependency`).
3. **Conceder `DATA_LOCATION_ACCESS`** al rol del crawler con `CfnPermissions`, **dependiente** del paso 2.
4. **Conceder `SELECT`** al rol "data-analyst" sobre `poc_gov_db.clientes`, **dependiente** del crawler.

En CDK eso se traduce a `addDependency` explícitos entre los recursos para que CloudFormation no los paralelice.

### 11.5 Recuperación si ya te bloqueaste

Si pierdes acceso de admin LF en medio de un deploy:

1. Iniciar sesión con un usuario root o un rol con permiso explícito `lakeformation:PutDataLakeSettings` que **no** dependa de ser admin LF.
2. Desde la consola Lake Formation → *Administrative roles and tasks* → añadirte de nuevo como Data Lake Administrator.
3. Reintentar `cdk deploy`.

Por eso el plan recomienda **siempre incluir el rol CDK en `admins`**: es la red de seguridad para no quedarte fuera.

### 11.6 Regla práctica

> En esta PoC **no** vaciamos `IAMAllowedPrincipals` ni cambiamos a "modo LF estricto". Usamos LF para **otorgar** permisos puntuales (analista, crawler) y registrar la location, dejando el modo híbrido por defecto. Pasar a modo estricto es un paso *post-PoC* deliberado.
