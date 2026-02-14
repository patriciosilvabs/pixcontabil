

# Corrigir icone do app ao instalar no celular (Android/iPhone)

## Problema
O app não possui um arquivo `manifest.json` (Web App Manifest) nem icones em tamanhos adequados para instalação mobile. Sem isso, Android e iOS usam um screenshot ou icone genérico ao adicionar o app na tela inicial.

## Solução

### 1. Criar icones PWA em multiplos tamanhos
Gerar versoes do icone do PixFlow nos tamanhos necessarios:
- `icon-192x192.png` (Android)
- `icon-512x512.png` (Android)
- `apple-touch-icon.png` (180x180, iOS)

Os icones serao criados na pasta `public/` usando o logo atual (cifrão com gradiente) via SVG inline convertido.

### 2. Criar arquivo `public/manifest.json`
Arquivo com metadados do app:
- Nome: "PixFlow"
- Nome curto: "PixFlow"
- Cor do tema e cor de fundo
- Icones nos tamanhos corretos
- display: "standalone" (para parecer um app nativo)

### 3. Atualizar `index.html`
Adicionar as tags necessarias no `<head>`:
- Link para o `manifest.json`
- Tag `apple-touch-icon` para iOS
- Meta tag `theme-color`
- Atualizar o titulo para "PixFlow"

## Detalhes tecnicos

Arquivos criados/modificados:
- `public/manifest.json` (novo)
- `public/icon-192x192.svg` (novo - SVG que funciona como icone)
- `public/icon-512x512.svg` (novo)
- `public/apple-touch-icon.svg` (novo)
- `index.html` (modificado - adicionar meta tags e links)

Nota: Como nao temos ferramenta de geracao de imagem PNG, os icones serao criados como SVG (que e suportado em manifests modernos) ou usaremos um icone inline SVG no manifest. Alternativamente, podemos criar um componente que gera o icone e orientar o usuario a exportar como PNG para melhor compatibilidade.

Para maxima compatibilidade (especialmente iOS que nao suporta SVG no apple-touch-icon), a abordagem mais robusta sera criar os icones como data URIs PNG ou solicitar ao usuario que forneca uma imagem PNG do logo.
