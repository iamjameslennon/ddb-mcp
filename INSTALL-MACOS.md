# Install ddb-mcp on macOS with Claude Desktop

A complete walkthrough starting from a fresh Mac. ~10 minutes.

## 1. Install Homebrew

Open the **Terminal** app (press `Cmd` + `Space`, type "Terminal", press Enter), then paste this and press Enter:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

You'll be asked for your Mac password (the one you log in with). Type it — it won't show any characters as you type, that's normal — and press Enter.

When the installer finishes, it prints a block starting with **"Next steps:"** containing two `eval` commands. Copy and run them in Terminal. They add Homebrew to your shell so the `brew` command works.

Check it worked:
```bash
brew --version
```
You should see something like `Homebrew 4.x.x`.

## 2. Install Node.js

In the same Terminal:

```bash
brew install node
```

This takes a minute or two. Check it worked:
```bash
node --version
```
You should see `v20.x.x` or higher.

## 3. Install Claude Desktop

1. Visit [claude.ai/download](https://claude.ai/download) and click the **macOS** button
2. Open the downloaded `.dmg` file
3. Drag the **Claude** icon into the **Applications** folder
4. Open Claude from your Applications folder and sign in with your Anthropic account

Once it's running, **fully quit it**: press `Cmd` + `Q` (clicking the red close button isn't enough). You'll reopen it in step 5.

## 4. Tell Claude Desktop about ddb-mcp

You're going to create a small config file. In Terminal, run these three lines one at a time:

```bash
mkdir -p ~/Library/Application\ Support/Claude
```

```bash
touch ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

```bash
open -e ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

The third command opens the file in TextEdit.

> ⚠️ **Important:** before you type anything, click **Format** in the menu bar and choose **Make Plain Text**. TextEdit's default mode replaces straight quotes (`"`) with curly ones (`"`), which breaks JSON.

Paste this exactly as shown:

```json
{
  "mcpServers": {
    "dndbeyond": {
      "command": "npx",
      "args": ["-y", "@iamjameslennon/ddb-mcp"]
    }
  }
}
```

Save the file: `Cmd` + `S`. Close TextEdit: `Cmd` + `Q`.

> If TextEdit complains about saving as `.txt`, click **Don't Add** to keep the `.json` extension.

> **Already have other MCP servers configured?** Add the `"dndbeyond": { ... }` block *inside* your existing `"mcpServers"` block, separated by a comma. The whole `mcpServers` object should still have just one set of `{ }` around it.

## 5. Restart Claude Desktop

Open the **Claude** app from Applications. The first launch loads the MCP server in the background — give it 30 seconds.

To verify it's connected, send Claude this message:

> What MCP tools do you have access to?

Claude should list `dndbeyond` tools (`ddb_login`, `ddb_list_characters`, and many more).

## 6. Log into D&D Beyond

Now send Claude:

> Log me into D&D Beyond

The **very first time** you do this, Claude will need to download Chromium (the browser used for D&D Beyond's login flow). It's a one-time ~140 MB download — Claude will show "Downloading Chromium..." in the tool output. Wait for it to finish (1–2 minutes on a typical connection).

Then a browser window opens automatically. Sign in to D&D Beyond with your Wizards / Hasbro account. When the page redirects back to the D&D Beyond home, the browser closes itself.

Your session is saved to your Mac and reused on every future call. You won't need to do this again until the session expires (usually weeks).

## 7. Try it out

Ask Claude any of these:

**As a player:**
> List my D&D Beyond characters

> Give me a full summary of my character Throin

> What spells does Throin have prepared right now?

> What's the rule for grappling?

**As a DM:**
> Rate this encounter for a party of 4 level 5 characters: 2 trolls and a hill giant

> What CR should I target for a Moderate difficulty encounter for my party of 3 level 8 characters?

> Roll a hoard for a CR 15 encounter, level 12 party

---

## Troubleshooting

**`brew: command not found` after step 1**
You skipped running the `eval` commands the installer told you to run. Scroll back in Terminal, find the "Next steps:" block, and run the two `eval` lines.

**Claude doesn't list dndbeyond tools in step 5**
1. Fully quit Claude: `Cmd` + `Q`. Reopen.
2. Check your JSON is valid. In Terminal:
   ```bash
   cat ~/Library/Application\ Support/Claude/claude_desktop_config.json
   ```
   Compare to the example above — every `"` should be straight, not curly. If unsure, paste the output into [jsonlint.com](https://jsonlint.com).
3. Check the logs:
   ```bash
   ls -lt ~/Library/Logs/Claude/ | head -5
   ```
   Open the most recent `mcp-server-dndbeyond.log` to see what went wrong.

**"Chromium install failed" on ddb_login**
The Playwright CDN is occasionally flaky. Just send "log me into D&D Beyond" again — the server retries automatically. If it keeps failing, run this in Terminal:
```bash
npx playwright install chromium
```
Then try `ddb_login` again.

**Claude can't find `npx` (mentioned in the log)**
You skipped step 2, or you opened Claude before installing Node. Quit Claude (`Cmd` + `Q`), reopen — Node is now on the PATH and Claude will pick it up.
