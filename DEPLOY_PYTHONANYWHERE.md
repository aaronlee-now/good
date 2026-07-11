# Deploy Fun Games to PythonAnywhere (free, always-on)

This guide puts your Snake game **and** its global leaderboard online at a free
address like `https://YOURNAME.pythonanywhere.com`. No credit card, no computer
left running at home — PythonAnywhere keeps the website up for you.

Anywhere you see `USERNAME` below, swap in the username you pick when you sign
up. Take your time and do the steps in order. 🙂

---

## What's going online

These files make up the site. You'll upload all of them:

- `flask_app.py` — the web app (serves the pages **and** the leaderboard API)
- `index.html` — the home page
- `style.css` — styles for the home page
- `snake.html` — the Snake game page
- `snake.js` — the Snake game code
- `snake.css` — styles for the game
- `requirements.txt` — lists Flask (already installed on PythonAnywhere)
- `leaderboard.json` — *optional.* If you skip it, the site starts with an empty
  board and creates a new one automatically. (See the note at the bottom.)

> You do **not** need to upload `server.py` or `README.md`. `server.py` is only
> for running the game on your own computer; `flask_app.py` is its twin made for
> PythonAnywhere.

---

## Step 1 — Make a free account

1. Go to **https://www.pythonanywhere.com**.
2. Click **Pricing & signup**, then under **"Create a Beginner account"** click
   **Create a Beginner account** (it's the free plan — no card needed).
3. Pick a **username** (this becomes part of your web address, e.g.
   `https://USERNAME.pythonanywhere.com`), an email, and a password.
4. Confirm your email if it asks, then log in. You'll land on the **Dashboard**.

---

## Step 2 — Get the files onto PythonAnywhere

The easiest way (no GitHub needed) is to **upload the files** using the website.

### Easiest: upload through the Files tab

1. On the top menu, click **Files**.
2. You'll see your home folder. In the **"Directories"** box, type `fungames`
   and click **New directory**. Click into the new `fungames` folder.
3. In the **"Files"** box, click **Upload a file** and pick each file from your
   computer's `fungames` folder. Upload these (one at a time is fine):
   - `flask_app.py`
   - `index.html`
   - `style.css`
   - `snake.html`
   - `snake.js`
   - `snake.css`
   - `requirements.txt`
   - `leaderboard.json` *(optional — see the note at the very bottom)*
4. When you're done, the path to your project is:
   **`/home/USERNAME/fungames`**  ← you'll need this in Step 3.

> **Alternative (only if your project is on GitHub):** open a **Bash console**
> from the Dashboard and run `git clone https://github.com/YOU/fungames.git`.
> That creates `/home/USERNAME/fungames` too. Upload is simpler if you're not
> sure — both end up in the same place.

---

## Step 3 — Create the web app

1. On the top menu, click **Web**.
2. Click **Add a new web app**. Click **Next** on the domain screen
   (the free `USERNAME.pythonanywhere.com` is already chosen).
3. When asked to pick a framework, choose **Manual configuration**
   (do **not** pick "Flask" — manual gives us full control). Click **Next**.
4. Choose a **Python version**. Pick the newest **Python 3.x** offered
   (for example **Python 3.10**). Click **Next**.
5. It finishes and shows your web app's configuration page. Leave it open —
   the next steps all happen here.

---

## Step 4 — Point the web app at `flask_app.py`

On that same **Web** configuration page:

### 4a. Set the Source code & Working directory

1. Find the **"Code"** section.
2. Set **Source code** to:  `/home/USERNAME/fungames`
3. Set **Working directory** to:  `/home/USERNAME/fungames`

### 4b. Edit the WSGI configuration file

1. Still in the **"Code"** section, click the link next to **WSGI configuration
   file** (it looks like `/var/www/USERNAME_pythonanywhere_com_wsgi.py`).
2. An editor opens with a lot of example text. **Select all and delete it**, then
   paste exactly this (change `USERNAME` to yours):

```python
import sys

# Tell Python where the project files live.
path = "/home/USERNAME/fungames"
if path not in sys.path:
    sys.path.insert(0, path)

# Import the Flask app and expose it as `application` (what WSGI looks for).
from flask_app import app as application
```

3. Click the green **Save** button (top right of the editor).

---

## Step 5 — Make sure Flask is available

Flask comes **preinstalled** on PythonAnywhere, so you normally don't need to do
anything. If the site later complains it can't find Flask, open a **Bash console**
from the Dashboard and run:

```bash
pip install --user Flask
```

Then reload (Step 6).

---

## Step 6 — Reload and visit your site

1. Go back to the **Web** tab.
2. Click the big green **Reload** button at the top.
3. Click your site link: **`https://USERNAME.pythonanywhere.com`**

Your game is now live on the internet — no computer of yours needs to stay on. 🎉

---

## Step 7 — Verify it works

Go through this quick checklist on `https://USERNAME.pythonanywhere.com`:

- [ ] The **home page** loads with the "Fun Games" title.
- [ ] Click **Play Snake** — the game page opens.
- [ ] Press **Start / Space** and play a round (eat a few apples 🍎).
- [ ] When the round ends, type a **name** and click **Submit score**.
- [ ] You see **"Saved to the global board!"** and your name appears on the
      leaderboard.
- [ ] **Refresh the page** — your score is still on the board (it was saved on
      the server, not just your browser).
- [ ] Open the same address on your **phone** — the same leaderboard shows up.

If all boxes check out, you're done. 🥳

---

## If something doesn't work

- **Error page / "Something went wrong"** → on the **Web** tab, open the
  **Error log** link. The last lines usually say what's wrong (often a typo in
  the WSGI file path — re-check `USERNAME` and `/home/USERNAME/fungames`).
- **Pages load but the leaderboard says "Couldn't load leaderboard."** → make
  sure `flask_app.py` is in `/home/USERNAME/fungames` and you clicked **Reload**.
- **"No module named flask"** → run the `pip install --user Flask` command in
  Step 5, then **Reload**.
- After **any** change to files or the WSGI config, click **Reload** again.

---

## Good to know

- **The online leaderboard is separate from your computer's.** PythonAnywhere
  has its own `leaderboard.json`. It starts **empty** (or with whatever you chose
  to upload) and fills up as people play online. Scores you made while testing on
  your own computer are **not** copied over unless you upload that file.
- **Always-on:** free **web apps** on PythonAnywhere stay running and reachable
  at your `USERNAME.pythonanywhere.com` address. (Free *consoles* time out, but
  the website does not.)
- **Free-tier limits:** the Beginner plan has modest CPU and traffic limits and
  only outbound access to an allow-list — none of that matters for this little
  game, which is plenty fast and only talks to itself.
