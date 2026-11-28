# Session Script Bot

**Session Script** is the phone app observers use while they sit in a conference session. Session Script Bot is this project: the app, the on-phone archive, and the coordinator summary tool.

Up to four observers can each keep their own log. Nothing is uploaded by itself. The phone stores every session, writes a text report and a spreadsheet, and the observer sends both files to [maarten.vanneste@meetingsupport.org](mailto:maarten.vanneste@meetingsupport.org).

## Record a session

Open `index.html` on the phone, or run the optional server below and open that address.

1. Enter the **session title**, **speaker name(s)** (one per line), the **room name**, the **planned session start** (date and time), **your name**, and, if you know it, the **estimated nr of participants**.
2. Tap **Next**. That opens the activity screen and does not start the clock.
3. Tap an activity to start timing. That first tap is the actual start, and the first activity begins then. Each later tap ends the activity that was running and starts the next one.

Activities: Introduction, Presentation, Conversations (CAT), Participant question, Q&A, Participants feedback, Survey, Closing remarks, and Other activity. Older logs stored CAT as Conversation and Participants feedback as Feedback; the phone still keeps those keys and shows the current names. Tapping an activity starts it at once. Other activity opens a sheet first: the note is required, Cancel leaves the previous activity running, and Drawing is a quick pick, so the line reads Other activity: Drawing. Older logs that used a separate Drawing category are kept as that same line.

The on-screen log is a dense list: one 13px line per activity, name and length only. A running line shows the live length. A note or group size is shortened on that same line. The full text, group size, and start time are in Edit. Start and end times stay in the TXT and CSV files.

A second tap on the same activity within 2 seconds is ignored. **Undo last tap** removes the last activity and starts the previous one again.

**Note** on the running card opens an optional note for the activity that is running. You can skip it or save it, and you can change it later from Edit. The note is kept in the archive and in the TXT and CSV files.

**Edit** on a line can change the activity, the note, and the group size. **Delete line** asks you to confirm, then removes that line and keeps the timeline continuous: the previous line extends to the next line’s start. If you delete the line that is still running, the previous line is running again.

Conversations (CAT) has **CAT group size avg estimate**: 2, 3, 4, 5, or 6. Older logs can still carry another number or plenary, and those values stay in the exports. Other activity still has an optional group size.

The log is saved on the phone as you go. Reloading the page does not clear it.

## End a session

**End session** is the bar at the bottom of the timing screen. The sheet asks **After the session closed**.

A slider runs from 0 to 100 in steps of 10, starting at 50. The thumb is the share who stayed talking: green fills from the left up to the thumb, and the red remainder is who left right away. The readout sits above the slider, stayed in green and left-right-away in red. A comment is optional. **Number of participants (Total)** is filled in from the estimate and, if you save, replaces that estimate.

**Save** stores the slider, the comment, and the participant count, then ends the session. **Skip** ends the session and stores none of that. **Cancel** leaves the session running.

When you confirm, the running activity ends and the session is archived on the phone. The app then writes two files:

`YYMMDD session-title observer.txt`
`YYMMDD session-title observer.csv`

Example: `261127 opening-keynote amina-yusuf.txt`.

- **Android Chrome** saves both files to Downloads.
- **iPhone** cannot save a file silently. The share sheet opens so you can choose **Save to Files**. Save both the TXT and the CSV, then email them.

The report lists every activity and these totals, with the share of the session. A category is left out when its time is 0 seconds. The Past sessions chart does the same:

- Presentation (including introduction)
- Conversations (CAT)
- Participants feedback
- Q&A (including participant questions)
- Survey
- Closing remarks
- Other (including Drawing)

It also includes the average group size (only activities that have one) and what happened after the session closed. An older session that still has a written answer shows that answer. A skipped answer is shown as —.

## Email to Maarten

**Email to Maarten** shares the CSV and the TXT together. The share title and text include `maarten.vanneste@meetingsupport.org`.

If the phone cannot share files, Mail opens with the text report in the body. Attach the CSV yourself. The app names the file to attach.

Share and New session sit on the same card as Email to Maarten. Ending a session still saves the TXT and CSV to Downloads.

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
| estimated_participants | Optional whole number from setup, corrected from Number of participants (Total) when the session is saved. The same value is repeated on every row of that session |
| left_right_away_pct | Share who left right away, 0–100. Repeated on every row. Blank when the question was skipped or the session still has an older written answer |
| room_name | Room name from setup. Repeated on every row of that session |
| room_speakers | Speaker names, separated by `; ` |
| segment_type | Introduction, Presentation, Conversations (CAT), Participant question, Q&A, Participants feedback, Survey, Closing remarks, or Other activity. Older files may say Conversation for CAT and Feedback for Participants feedback. A former Drawing line is Other activity, with Drawing in the note |
| start | Local start, `YYYY-MM-DD HH:MM:SS` |
| end | Local end, same format |
| duration_seconds | Whole seconds |
| group_size | Empty, or a whole number. Empty when the group size avg is plenary |
| group_size_avg | Empty, a whole number, or `plenary` (the whole room) |
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

- **segment_type** — each activity across all files, including Participants feedback and Closing remarks: count, total seconds, average seconds, share of all recorded time, average group size, and how many lines were plenary
- **bucket** — the same roll-up the phone report uses (presentation includes introduction, Participants feedback is its own total, Q&A includes participant questions)
- **session** — one row per exported session: total time, average group size, room name, the estimated number of participants, and the average left-right-away and stayed-talking shares when the CSV has them
- **session_segment** — each activity inside one session, with that session's share of time
- **total** — everything added together, including the average of those shares across sessions that recorded one

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
