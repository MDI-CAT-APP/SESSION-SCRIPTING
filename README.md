# Session Script Bot

**Session Script** is the phone app observers use while they sit in a conference session. Session Script Bot is this project: the app, the on-phone archive, and the coordinator summary tool.

Up to four observers can each keep their own log. Nothing is uploaded by itself. The phone stores every session, writes a text report and a spreadsheet, and the observer sends both files to [maarten.vanneste@meetingsupport.org](mailto:maarten.vanneste@meetingsupport.org).

## Record a session

Open `index.html` on the phone, or run the optional server below and open that address.

1. Enter the **session title**, **speaker name(s)** (one per line), the **planned start** (date and time), and **your name**.
2. Tap **Start timing**.
3. Tap an activity when the session moves on. That tap ends the segment that was running and starts the next one. The start time is the moment you tap the activity.

Activities: Introduction, Presentation, Conversation, Q&A, Participant question, Survey, Drawing, and Other activity. Other activity asks what is happening. The time shown is still the moment you tapped the button, not the moment you finished typing.

The running segment shows its name, start time, and a live timer. Duration is shown only after the segment has ended (the next tap, or End session).

A second tap on the same activity within 2 seconds is ignored. **Undo last tap** removes the last segment and starts the previous one again.

Each segment can take an optional note. Conversation and Other activity also take an optional numeric **group size** (for example a role play in groups of four, with a note about the feedback).

The log is saved on the phone as you go. Reloading the page does not clear it.

## End a session

**End session** is the bar at the bottom of the timing screen. The session is not saved as finished until you answer:

**What happened after the speaker's closing announcement?**

- People left right away
- People stayed talking
- Mixed
- Other (a short description is required)

A comment is optional.

When you confirm, the running segment ends and the session is archived on the phone. The app then writes two files:

`YYMMDD session-title observer.txt`
`YYMMDD session-title observer.csv`

Example: `261127 opening-keynote amina-yusuf.txt`.

- **Android Chrome** saves both files to Downloads.
- **iPhone** cannot save a file silently. The share sheet opens so you can choose **Save to Files**. Save both the TXT and the CSV, then email them.

The report lists every segment and these totals, with the share of the session:

- Presentation (including introduction)
- Conversation
- Q&A (including participant questions)
- Survey
- Drawing
- Other

It also includes the average group size (only segments that have one) and the closing answer.

## Email to Maarten

**Email to Maarten** shares the CSV and the TXT together. The share title and text include `maarten.vanneste@meetingsupport.org`.

If the phone cannot share files, Mail opens with the text report in the body. Attach the CSV yourself. The app names the file to attach.

Save TXT, Save CSV, Share, WhatsApp, and Copy are there as well.

## Past sessions

**Past** lists every session kept on this phone. Open one to read it, export it again, or email it.

**New session** never deletes an existing session. A session you did not export is still in the list.

**Delete** removes one session from this phone, and only after you confirm. Files you already saved in Downloads or Files are not removed.

## Spreadsheet columns

Every observer's CSV uses the same header, so files from several rooms can be stacked:

| Column | Meaning |
| --- | --- |
| session | Session title |
| observer | Observer name |
| room_speakers | Speaker names, separated by `; ` |
| segment_type | Introduction, Presentation, Conversation, Q&A, Participant question, Survey, Drawing, or Other activity |
| start | Local start, `YYYY-MM-DD HH:MM:SS` |
| end | Local end, same format |
| duration_seconds | Whole seconds |
| group_size | Empty, or a whole number |
| note | Optional note. For Other activity this is the description, then ` - `, then the note |

The file is UTF-8 with a byte order mark so Excel opens the text correctly.

## Combine the spreadsheets

After the CSV files are in one folder on your computer:

```bash
python3 tools/combine.py /path/to/csv-folder
```

That writes `/path/to/csv-folder/session-script-summary.csv`. To choose the file:

```bash
python3 tools/combine.py /path/to/csv-folder -o /path/to/session-script-summary.csv
```

Python 3 only. No packages to install.

The summary is one sheet with a `section` column:

- **segment_type** — each activity across all files: count, total seconds, average seconds, share of all recorded time, average group size
- **bucket** — the same roll-up the phone report uses (presentation includes introduction, Q&A includes participant questions)
- **session** — one row per exported session: total time and average group size
- **session_segment** — each activity inside one session, with that session's share of time
- **total** — everything added together

`share_of_time_percent` is a number such as `46.7`. Within each section the shares are rounded to one decimal and adjusted so they add up to 100.

## Optional server

The app does not need a server. On a venue Wi-Fi network you can still run `server.py` so phones open the app from one Mac and, if you want, send a copy into the `reports` folder.

```bash
python3 server.py
```

Then open `http://127.0.0.1:8080/` on the Mac. Phones on the same Wi-Fi open `http://YOUR-MAC-IP:8080/`. Find the address with `ipconfig getifaddr en0` (try `en1` if that prints nothing). Another port: `PORT=9090 python3 server.py`.

**Send to server** appears only when the app was opened from that server. It stores the TXT and the CSV. Stop the server with Ctrl+C.

Opening `index.html` directly also works. The offline install (service worker) needs `http://` or `https://`.

## Files

- `index.html`, `styles.css`, `app.js` — Session Script
- `manifest.json`, `sw.js`, `icons/` — installable app
- `tools/combine.py` — coordinator summary
- `server.py` — optional collector
- `reports/` — files sent to the optional server
