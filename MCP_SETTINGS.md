# Gemini CLI MCP Configuration

Heto ang merged configuration para sa iyong `.gemini/settings.json`. Kasama na rito ang iyong lumang settings (UI footer, Auth) at ang mga bagong MCP servers (`fetch` at `sequential-thinking`).

## 1. JSON Configuration
I-copy at i-paste ito sa iyong `.gemini/settings.json`:

```json
{
  "theme": "Default",
  "selectedAuthType": "oauth-personal",
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-github"
      ],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "YOUR_GITHUB_TOKEN_HERE"
      }
    },
    "fetch": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-fetch"
      ]
    },
    "sequential-thinking": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-sequential-thinking"
      ]
    }
  },
  "security": {
    "auth": {
      "selectedType": "oauth-personal"
    }
  },
  "ui": {
    "footer": {
      "items": [
        "workspace",
        "git-branch",
        "model-name",
        "quota",
        "context-used",
        "auth",
        "token-count"
      ]
    }
  }
}
```

## 2. Paano i-apply:
1. Siguraduhing naitabi mo ang iyong **GitHub Personal Access Token** sa line 15 (palitan ang `"token to"`).
2. I-save ang file.
3. Sa Gemini CLI, i-run ang:
   ```bash
   /mcp reload
   ```
4. Kung ito ang unang beses mong gagamit ng project-scoped settings, i-run din ito sa iyong terminal:
   ```bash
   gemini trust
   ```

## 3. Bakit natin ito nilagay?
*   **github**: Para sa code search at repo management.
*   **fetch**: Para basahin ang mga Acumatica API documentation online.
*   **sequential-thinking**: Para sa mas masusing pag-isip ni Gemini sa mga complex logic.
