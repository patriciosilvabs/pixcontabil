

## Trocar a imagem de preview social (Open Graph) para a logo da empresa

### Problema

As meta tags `og:image` e `twitter:image` no `index.html` apontam para `https://lovable.dev/opengraph-image-p98pqg.png` — a imagem padrão do Lovable. Por isso, ao compartilhar o link do site no WhatsApp, Telegram, etc., aparece o logo do Lovable.

### O que você precisa fazer

Você precisa me enviar uma **imagem** para usar como preview social. O ideal é:
- Formato PNG ou JPG
- Resolução recomendada: **1200×630 pixels** (padrão Open Graph)
- Conteúdo: logo da Pix Contábil, nome e descrição curta sobre fundo roxo (ou o que preferir)

### O que eu vou alterar

**`index.html`** — atualizar 3 meta tags:

```html
<!-- Trocar estas linhas -->
<meta property="og:image" content="https://lovable.dev/opengraph-image-p98pqg.png" />
<meta name="twitter:site" content="@Lovable" />
<meta name="twitter:image" content="https://lovable.dev/opengraph-image-p98pqg.png" />

<!-- Por estas -->
<meta property="og:image" content="/og-image.png" />
<meta property="og:url" content="https://pixmobile.com.br" />
<meta name="twitter:site" content="@PixContabil" />
<meta name="twitter:image" content="/og-image.png" />
```

A imagem será copiada para `public/og-image.png`.

### Importante

Após a alteração, os caches do WhatsApp/Telegram podem demorar para atualizar. O WhatsApp, por exemplo, cacheia previews por dias. Você pode forçar uma atualização usando ferramentas como o [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/).

### Próximo passo

**Envie a imagem** que deseja usar como preview e eu faço a implementação.

