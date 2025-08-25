
# MoveBuss • Registro de Caixas

Site estático para GitHub Pages com Firebase Authentication + Firestore.

## Como publicar
1. Crie um repositório no GitHub (público).
2. Envie todos os arquivos deste ZIP para a branch `main`.
3. Ative GitHub Pages em *Settings › Pages* apontando para a branch `main` (root).
4. Acesse a URL do Pages.

## Importante
- Login é realizado por **matrícula** e senha. Internamente a matrícula vira e-mail `${matricula}@movebuss.com` no Firebase Auth.
- Apenas **um caixa aberto por matrícula**. Vários usuários podem ter caixas simultâneos.
- Impressão de recibo térmico é chamada automaticamente (abre a janela de impressão do navegador) com tamanho 80mm x 150mm e fonte 15px.
- Fechamento do caixa gera **PDF A4** com resumo completo, baixado automaticamente com nome `MATRICULA-YYYY-MM-DD.pdf`.
- Estrutura no Firestore: `users/{uid}/caixas/{caixaId}/(lancamentos|sangrias)` compatível com suas regras.
- Admins automáticos pelas matrículas: 4144, 70029 e 6266 (badge dourada).
- Persistência do login está ativada (browserLocalPersistence).
