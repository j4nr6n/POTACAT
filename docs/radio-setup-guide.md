# Radio Setup Guide

POTACAT supports four ways to connect to your radio. Choose the one that matches your setup.

---

## FlexRadio (SmartSDR)

**Best for:** FlexRadio 6000/8000 series running SmartSDR

POTACAT connects directly to SmartSDR's built-in CAT server over TCP. No additional software or cables are needed — just a network connection to your Flex.

### Setup

1. Open Settings and add a new rig
2. Select **FlexRadio (SmartSDR)**
3. Choose your slice (A, B, C, or D)
4. Save

### How It Works

SmartSDR exposes Kenwood-compatible CAT control on TCP ports 5002–5005, one per slice:

| Slice | Port |
|-------|------|
| A     | 5002 |
| B     | 5003 |
| C     | 5004 |
| D     | 5005 |

POTACAT connects to `127.0.0.1` on the selected port. If SmartSDR is running on a different computer, use the **IP Radio (TCP CAT)** option instead and enter the Flex's IP address.

### SmartSDR Panadapter Spots

If you enable **Push spots to SmartSDR panadapter** in Settings, POTACAT will also connect to the FlexRadio API on port 4992 and display spot markers directly on your panadapter. You can choose which spot sources (POTA, SOTA, DX Cluster, RBN) appear on the panadapter.

---

## IP Radio (TCP CAT)

**Best for:** FlexRadio on a remote computer, Elecraft K4, or any radio with a TCP-based Kenwood CAT interface

This is the same Kenwood CAT protocol as the FlexRadio option, but lets you specify a custom IP address and port.

### Setup

1. Open Settings and add a new rig
2. Select **IP Radio (TCP CAT)**
3. Enter the host IP and port
4. Save

### Common Uses

- **FlexRadio on another PC:** Enter the Flex's LAN IP address (e.g., `192.168.1.50`) and the slice port (5002–5005)
- **Elecraft K4:** The K4 offers a TCP CAT server when connected via Ethernet
- **Remote rigs:** Any radio accessible over the network via TCP CAT

---

## Serial CAT (Kenwood)

**Best for:** QRPLabs QMX, QRPLabs QDX, and other radios that speak Kenwood CAT protocol over a USB serial connection

This option sends standard Kenwood CAT commands (`FA`, `MD`) directly over a serial port. It's simpler and more reliable than Hamlib for radios that support basic Kenwood commands but don't perfectly match a specific Hamlib rig model.

### Setup

1. Open Settings and add a new rig
2. Select **Serial CAT (Kenwood)**
3. Choose your COM port from the dropdown (or type it manually)
4. Set the correct baud rate for your radio
5. Check **Disable DTR/RTS on connect** if your radio uses DTR for PTT (see notes below)
6. Click **Test Connection** to verify
7. Save

### Supported Commands

POTACAT uses only two CAT commands:

- `FA` — Get/set VFO A frequency (11-digit Hz value)
- `MD` — Set mode (CW, USB, LSB, FM, DIGU, DIGL)

Any radio that responds to `FA;` with a frequency like `FA00014060000;` will work.

### DTR/RTS

Many USB serial interfaces (including built-in USB on QRP radios) use the DTR and RTS control lines. Some radios interpret DTR as a PTT signal — when the serial port opens, the OS asserts DTR by default, which keys your transmitter.

**Check "Disable DTR/RTS on connect" if:**
- Your radio transmits unexpectedly when POTACAT connects
- You use a QRPLabs QMX or QDX
- You use a Digirig, SignaLink, or similar USB audio/serial interface
- Your radio resets or behaves erratically when the serial port opens

### Radio-Specific Notes

#### QRPLabs QMX / QMX+

| Setting | Value |
|---------|-------|
| Connection type | Serial CAT (Kenwood) |
| Baud rate | 38400 (check your QMX firmware settings) |
| Disable DTR/RTS | Yes (required — QMX uses DTR for PTT) |

**Important notes:**
- Do **not** use the "Other Rig (Hamlib)" option — Hamlib's protocol checks are too strict for the QMX's Kenwood implementation and will fail with protocol errors.
- If the QMX stops responding to CAT commands or the Test Connection shows diagnostic text instead of a frequency, **power cycle the radio**. Terminal programs like PuTTY can put the QMX into a debug/terminal mode that persists until reboot.
- The QMX creates a single USB serial port. Make sure no other software (PuTTY, WSJT-X, N3FJP, etc.) has the port open — only one program can use a COM port at a time.

#### QRPLabs QDX

Same settings as the QMX. The QDX also uses Kenwood CAT protocol over USB serial.

#### Kenwood Radios (TS-480, TS-590, TS-2000, etc.)

Most Kenwood radios work with either Serial CAT or Hamlib. Serial CAT is simpler if you only need frequency and mode control. Use Hamlib if you need advanced features.

| Setting | Value |
|---------|-------|
| Connection type | Serial CAT (Kenwood) |
| Baud rate | 9600 (check your radio's menu) |
| Disable DTR/RTS | Usually not needed |

#### Elecraft (KX2, KX3, K3, K3S)

Elecraft radios support Kenwood CAT commands. Serial CAT works well for basic frequency/mode control.

| Setting | Value |
|---------|-------|
| Connection type | Serial CAT (Kenwood) |
| Baud rate | 38400 (default for most Elecraft radios) |
| Disable DTR/RTS | Usually not needed |

#### Yaesu FT-891

| Setting | Value |
|---------|-------|
| Connection type | Serial CAT (Kenwood) |
| Baud rate | 38400 |
| Disable DTR/RTS | No |

The FT-891 uses 9-digit `FA` commands and `MD0` syntax (with VFO selector). POTACAT auto-detects this on first connection.

**ATU / ATAS-120A:** The FT-891 does not support ATU control via CAT commands. The `AC` (Antenna Tuner Control) command is rejected regardless of format. If you use an ATAS-120A or similar motorized antenna, use the physical TNR button on the radio. POTACAT's auto-tune-on-band-change feature will not work with this radio.

**Split mode:** The FT-891 does not support the `FT` (Function TX) command for setting split mode via CAT. POTACAT skips this command automatically on Yaesu radios.

#### Yaesu FT-991A / FTDX101D

| Setting | Value |
|---------|-------|
| Connection type | Serial CAT (Kenwood) |
| Baud rate | 38400 |
| Disable DTR/RTS | Usually not needed |

These radios support the `AC` command for ATU control. POTACAT's auto-tune-on-band-change feature works with the built-in antenna tuner.

#### Yaesu with Win4Yaesu Suite

If you run Win4Yaesu Suite alongside POTACAT, see the [Win4Yaesu section](#using-potacat-with-win4yaesu-suite) below for virtual COM port setup.

---

## Other Rig (Hamlib)

**Best for:** Icom, Yaesu, and other radios that don't speak Kenwood CAT protocol

This option uses [Hamlib](https://hamlib.github.io/) (rigctld) to translate between POTACAT and your radio's native protocol. Hamlib supports over 200 radio models from all major manufacturers.

POTACAT bundles Hamlib 4.6.5 for Windows — no separate installation needed.

### Setup

1. Open Settings and add a new rig
2. Select **Other Rig (Hamlib)**
3. Search for your radio model in the dropdown
4. Choose your COM port from the dropdown (or type it manually)
5. Set the correct baud rate
6. Check **Disable DTR/RTS on connect** if needed (see Serial CAT section above for guidance)
7. Click **Test Connection** to verify
8. Save

### How It Works

When you select a Hamlib rig, POTACAT:

1. Spawns a `rigctld` process with your rig model, serial port, and baud rate
2. Connects to rigctld over TCP (localhost port 4532)
3. Polls frequency using rigctld's simple text protocol
4. Sends tune commands through rigctld, which translates them to your radio's native protocol

### Troubleshooting

#### "Protocol error" on Test Connection

Hamlib's rig backends send initialization commands (ID, power status, etc.) and validate the responses strictly. If your radio's responses don't exactly match what the backend expects, you'll see a protocol error.

**Try these steps:**
1. Make sure you selected the correct rig model (not a similar one)
2. Verify the baud rate matches your radio's settings
3. If your radio supports Kenwood CAT commands, try **Serial CAT (Kenwood)** instead — it's more forgiving
4. Check if a firmware update is available for your radio

#### "Access denied" on Test Connection

Another program has your COM port open. Close any other software that might be using it (logging programs, digital mode software, terminal programs, other CAT controllers).

#### "Timed out" on Test Connection

Rigctld started but your radio didn't respond. Check:
- Is the correct COM port selected?
- Is the baud rate correct?
- Is the cable connected and the radio powered on?
- Is another program holding the COM port?

#### Connection drops after a while

Some radios need the DTR/RTS lines managed carefully. Try toggling the **Disable DTR/RTS on connect** checkbox.

---

## rigctld Network (flrig, grig, etc.)

**Best for:** Radios controlled by flrig, grig, or any software that exposes a rigctld-compatible TCP server — especially on Linux (Raspberry Pi, etc.)

If you already use **flrig** to control your radio, you don't need POTACAT's bundled Hamlib at all. flrig includes a built-in rigctld emulation server that POTACAT can connect to directly over TCP.

### Setup

1. Open Settings and add a new rig
2. Select **rigctld Network**
3. Set the host:
   - Same machine as flrig: `127.0.0.1`
   - Different machine: enter the IP address of the computer running flrig (e.g., `192.168.1.50`)
4. Set the port to `4532` (flrig's default rigctld port)
5. Save

### Enabling the rigctld Server in flrig

1. In flrig, go to **Config → Setup → Server**
2. Make sure the rigctld server is enabled
3. Note the port number (default `4532`)

> **Tip:** flrig also has an XML-RPC server (port 12345) — POTACAT does **not** use XML-RPC. Make sure you're connecting to the rigctld port, not the XML-RPC port.

### Common Uses

- **Raspberry Pi + flrig:** flrig handles the serial connection to your radio, POTACAT connects over TCP on the same Pi or over the LAN
- **Xiegu X6100 / G90 via flrig:** flrig supports CI-V radios that don't work with Serial CAT (Kenwood)
- **Remote operation:** flrig on the radio PC, POTACAT on your operating PC — connect over LAN
- **Sharing the radio:** flrig owns the serial port and multiple programs (POTACAT, WSJT-X, fldigi) can connect via separate rigctld clients

### Troubleshooting

- **Connection refused:** Make sure flrig is running and the rigctld server is enabled. Check that the port matches.
- **Wrong frequency / no response:** Verify flrig can control the radio directly (tune via flrig's UI). If flrig itself can't talk to the radio, POTACAT won't be able to either.
- **Firewall:** If connecting across machines, make sure the firewall on the flrig machine allows inbound TCP on the rigctld port.

---

## Using POTACAT with Win4Yaesu Suite

**Best for:** Running POTACAT alongside Win4Yaesu Suite without CAT port conflicts

If you use Win4Yaesu Suite to control your Yaesu radio, both programs will fight for the serial port if they try to connect directly. The solution is to let Win4Yaesu own the serial port and route POTACAT's CAT commands through one of Win4Yaesu's **AUX/CAT ports** using a virtual COM port pair.

Win4Yaesu caches the radio's state in memory and exposes it through 4 AUX/CAT ports. External programs connected to these ports see what looks like a real Yaesu radio — but read commands are served from cache (so high polling rates don't slow down the radio), and write commands (frequency/mode changes) are forwarded to the radio immediately.

### What You Need

- **Win4Yaesu Suite** connected to your radio
- **COM0COM** (free, open-source virtual COM port driver for Windows)

### Setup

#### 1. Install COM0COM

Download the **signed 64-bit version** of COM0COM from SourceForge. Install it and let it run on startup (it must be running before Win4Yaesu starts).

> **Important:** Only use the signed version. Unsigned versions can cause driver issues on 64-bit Windows.

#### 2. Create a Virtual COM Port Pair

Open the COM0COM Setup utility (from Start Menu → COM0COM → Setup). Create a new pair and rename them to regular COM port names that don't already exist on your system (e.g., `COM18` and `COM19`). Make sure neither port name shows in red — red means the name is already in use.

#### 3. Configure Win4Yaesu

1. In Win4Yaesu, go to **Tools → Settings → 3rd Party SW/HW**
2. Set one of the 4 AUX/CAT ports to one end of your virtual pair (e.g., `COM18`)
3. Save and restart Win4Yaesu if prompted

#### 4. Configure POTACAT

1. In POTACAT Settings, add a new rig (or edit your existing Yaesu rig)
2. Select **Serial CAT (Kenwood)** as the connection type
3. Set the COM port to the **other end** of the virtual pair (e.g., `COM19`)
4. Set the baud rate to match your radio (typically 9600 or 38400)
5. Check **Disable DTR/RTS on connect**
6. Save

> **Why "Kenwood"?** Yaesu and Kenwood radios use the same CAT command format (`FA` for frequency, `MD` for mode, semicolon-delimited). POTACAT's Serial CAT works with both protocols.

### How It Works

```
POTACAT  ←→  COM19 ──(COM0COM)── COM18  ←→  Win4Yaesu  ←→  Radio
```

- POTACAT sends `FA;` to poll frequency and `FA00014060000;` to tune — Win4Yaesu handles these through its AUX/CAT port
- Win4Yaesu serves frequency queries from its in-memory cache, so POTACAT's 1-second polling doesn't add extra load on the radio
- Tune commands from POTACAT are forwarded to the radio immediately
- Win4Yaesu, WSJT-X, N1MM+, and other programs can all run simultaneously — each on its own AUX/CAT port

### Troubleshooting

- **POTACAT can't open the port:** Make sure COM0COM is running and the port names match exactly. The COM0COM Setup utility must show the pair as active.
- **No frequency updates:** Verify you're using the correct ends of the pair — one end goes to Win4Yaesu, the other to POTACAT. If they're swapped, neither will connect.
- **Stale COM ports:** If a port name shows in red in COM0COM Setup, it's already claimed by another device. Open Device Manager → View → Show Hidden Devices → Ports (COM & LPT) to find and uninstall stale entries.

---

## Using POTACAT with Win4IcomSuites

**Best for:** Running POTACAT alongside Win4IcomSuites without CAT port conflicts (IC-7300, IC-7610, IC-9700, IC-705, and other Icom radios)

If you use Win4IcomSuites to control your Icom radio, both programs will fight for the serial port if they try to connect directly. The solution is to let Win4Icom own the real serial port and route POTACAT's CAT commands through a **virtual COM port** using COM0COM.

Win4Icom exposes CI-V CAT commands through virtual ports, so external programs like POTACAT can read frequency/mode and send tune commands without conflicting with Win4Icom's own connection to the radio.

### What You Need

- **Win4IcomSuites** connected to your radio
- **COM0COM** (free, open-source virtual COM port driver for Windows)

### Setup

#### 1. Install COM0COM

Download the **signed 64-bit version** of COM0COM from SourceForge. Install it and let it run on startup (it must be running before Win4Icom starts).

> **Important:** Only use the signed version. Unsigned versions can cause driver issues on 64-bit Windows.

#### 2. Create a Virtual COM Port Pair

Open the COM0COM Setup utility (from Start Menu → COM0COM → Setup). Create a new pair and rename them to regular COM port names that don't already exist on your system (e.g., `COM18` and `COM19`). Make sure neither port name shows in red — red means the name is already in use.

#### 3. Configure Win4IcomSuites

1. In Win4Icom, go to **Setup → CI-V Interface**
2. Under **Virtual COM Ports**, enable one of the virtual port slots and set it to one end of your COM0COM pair (e.g., `COM18`)
3. Make sure the CI-V address matches your radio (default `94` for IC-7300, `98` for IC-7610, `A2` for IC-9700)
4. Save and restart Win4Icom if prompted

#### 4. Configure POTACAT

1. In POTACAT Settings, add a new rig (or edit your existing Icom rig)
2. Select **Hamlib** as the connection type
3. Search for and select your radio model (e.g., `Icom IC-7300`)
4. The COM port dropdown may not list virtual COM ports — **type the port name directly** in the text field next to the dropdown (e.g., `COM19`)
5. Set the baud rate to match your radio (typically 19200 for IC-7300)
6. Save

> **Why Hamlib?** Icom radios use the CI-V protocol, which is different from the Kenwood/Yaesu FA/MD command set. Hamlib translates POTACAT's commands into CI-V format automatically.

### How It Works

```
POTACAT  ←→  COM19 ──(COM0COM)── COM18  ←→  Win4Icom  ←→  Radio
```

- POTACAT talks to Hamlib, which sends CI-V commands to `COM19`
- COM0COM bridges `COM19` to `COM18`, where Win4Icom is listening
- Win4Icom forwards tune commands to the radio and returns frequency/mode data
- Win4Icom, WSJT-X, and other programs can all run simultaneously — each on its own virtual port

### Troubleshooting

- **POTACAT can't open the port:** Make sure COM0COM is running and the port names match exactly. If the port doesn't appear in the dropdown, type it manually in the text field — virtual COM ports often don't show up in Windows' port enumeration.
- **No frequency updates:** Verify you're using the correct ends of the pair — one end goes to Win4Icom, the other to POTACAT. If they're swapped, neither will connect.
- **Wrong rig model in Hamlib:** The rig model must match your actual radio. Using a generic "Icom" model may work for basic frequency/mode but can cause issues with some commands.
- **Stale COM ports:** If a port name shows in red in COM0COM Setup, it's already claimed by another device. Open Device Manager → View → Show Hidden Devices → Ports (COM & LPT) to find and uninstall stale entries.

---

## General Tips

### Only One Program Per COM Port

Serial ports can only be used by one program at a time. If POTACAT can't connect, make sure you've closed any other software using the same port: WSJT-X, fldigi, N3FJP, HRD, PuTTY, etc.

> **Exception:** If you use Win4Yaesu Suite or Win4IcomSuites, you don't need to close them — see the [Win4Yaesu](#using-potacat-with-win4yaesu-suite) or [Win4Icom](#using-potacat-with-win4icomsuites) sections above for how to run both programs at the same time.

### Finding Your COM Port

- **Windows:** Open Device Manager → Ports (COM & LPT). Your radio's USB serial adapter will be listed with its COM port number.
- When you plug/unplug your radio's USB cable, the port that appears/disappears is the one you want.
- If your COM port isn't in the dropdown, you can type it manually in the text field next to the dropdown.

### CW XIT Offset

When tuning to CW spots, you can set a transmit offset in Settings (CW XIT Offset, in Hz). This shifts your tune frequency so your transmit signal lands at the correct offset from the activator's frequency. Typical values are 0 to 700 Hz.
