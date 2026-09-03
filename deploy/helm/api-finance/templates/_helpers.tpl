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
