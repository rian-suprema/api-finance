{{/*
Helpers padrão do chart — nome, fullname e labels recomendados pelo Helm.
*/}}
{{- define "api-finance.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "api-finance.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name (include "api-finance.name" .) | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}

{{- define "api-finance.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
app.kubernetes.io/name: {{ include "api-finance.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "api-finance.selectorLabels" -}}
app.kubernetes.io/name: {{ include "api-finance.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Labels dos pods dos Jobs (migrations, seed). Diferentes do selectorLabels de propósito:
o Service, o PDB e o spread do Deployment NÃO podem selecionar pods de Job (o Service
mandaria tráfego para um pod que não serve a API durante o sync).
*/}}
{{- define "api-finance.jobSelectorLabels" -}}
app.kubernetes.io/name: {{ include "api-finance.name" . }}-job
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
