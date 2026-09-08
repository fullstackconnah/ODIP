# Oassist Paper Forms — Structured Inventory

Source: `D:\Documents\Downloads\Oassist Files\` (four `.docx` files, read-only, extracted via python-docx preserving table cell/row structure and checkbox markers).

> **PHI NOTICE:** "CLIENT OVERVIEW FORM Mastercopy.docx" was found already filled in with a real, named participant's health, disability and behaviour-support data (name, diagnosis, behaviours of concern, restrictive practices, etc.), not a blank template. To avoid committing personal health information into this repository, the inventory below for that document records **field labels and control structure only** — all actual filled-in values (the participant's name, diagnosis text, behavioural narrative, etc.) have been deliberately omitted/redacted. This should be flagged to whoever supplied the source files; a genuinely blank master copy should be substituted if one exists.

Where a docx table used merged/spanned cells, python-docx sometimes reports the same cell content repeated across multiple grid columns. This is called out inline as "(merged-cell artifact)" rather than treated as N distinct fields.

---

## 1a Oassist Intake Client Needs Assessment Form Print.docx

### Purpose
A comprehensive intake form capturing the participant's contact network (residence, coordinator, funds manager, family, administrator, signatory), NDIS plan basics, core support/night-support ratios, a large clinical/support-plan checklist (behaviour, restrictive practices, epilepsy, diabetes, bowel, wound, asthma, health plans), equipment/mobility/diet needs, and cultural/rights-information acknowledgements. No page/section numbering is present in the body; the whole document is 5 large tables with bold header rows, no free paragraphs. No document title text was found in the body or header — filename is the only title source.

### Sections, in document order

#### Table 1 — Contact network (33 rows, 5 cols, grouped by bold header rows)

**PARTICIPANT DETAILS**

| Field label | Control type | Options | Required marker? | Notes |
|---|---|---|---|---|
| Name | text | — | No | |
| DOB | date | — | No | |
| Address | text | — | No | |
| Email | text | — | No | |
| Phone | text | — | No | |

**RESIDENCE CONTACTS** (table-repeater — two contact blocks present, identical field set)

| Field label | Control type | Options | Required marker? | Notes |
|---|---|---|---|---|
| Name | text | — | No | repeats x2 (two residence contacts) |
| Position | text | — | No | repeats x2 |
| Email | text | — | No | repeats x2 |
| Phone | text | — | No | repeats x2 |

**SUPPORT COORDINATOR**

| Field label | Control type | Options | Required marker? | Notes |
|---|---|---|---|---|
| Name | text | — | No | |
| Phone | text | — | No | |
| Organisation | text | — | No | |
| Email | text | — | No | |

**NDIS FUNDS MANAGER**

| Field label | Control type | Options | Required marker? | Notes |
|---|---|---|---|---|
| Name | text | — | No | |
| Phone | text | — | No | |
| Organisation | text | — | No | |
| Email | text | — | No | |

**FAMILY/OTHER**

| Field label | Control type | Options | Required marker? | Notes |
|---|---|---|---|---|
| Name | text | — | No | |
| Relationship | text | — | No | |
| Address | text | — | No | |
| Email | text | — | No | |
| Phone | text | — | No | |

**ADMINISTRATOR**

| Field label | Control type | Options | Required marker? | Notes |
|---|---|---|---|---|
| Name | text | — | No | |
| Relationship | text | — | No | |
| Organisation | text | — | No | |
| Email | text | — | No | |
| Phone | text | — | No | |

**AUTHORISED SIGNATORY**

| Field label | Control type | Options | Required marker? | Notes |
|---|---|---|---|---|
| Name | text | — | No | |
| Relationship | text | — | No | |
| Organisation | text | — | No | |
| Email | text | — | No | |
| Phone | text | — | No | |

**Responsible for welfare checks if living independently** (sub-block, same shape as Authorised Signatory)

| Field label | Control type | Options | Required marker? | Notes |
|---|---|---|---|---|
| Name | text | — | No | |
| Relationship | text | — | No | |
| Organisation | text | — | No | |
| Email | text | — | No | |
| Phone | text | — | No | |

#### Table 2 — NDIS INFORMATION (3 rows, 7 cols)

| Field label | Control type | Options | Required marker? | Notes |
|---|---|---|---|---|
| NDIS FUNDING | checkbox (legacy form-field) | Y / N | No | |
| PLAN TYPE | checkbox (legacy form-field), select-one intent | SELF / AGENCY / PLAN | No | rendered as 3 separate legacy checkboxes, not a true radio group |
| NDIS # | text | — | No | |
| PLAN DATES — START | date | — | No | |
| PLAN DATES — FINISH | date | — | No | |

#### Table 3 — CORE SUPPORT DETAILS (13 rows, 5 cols)

| Field label | Control type | Options | Required marker? | Notes |
|---|---|---|---|---|
| SUPPORT RATIO — DAY | text | — | No | ratio value, e.g. "1:1" |
| SUPPORT RATIO — EVENING/AM | text | — | No | |
| NIGHT SUPPORT | checkbox group | Active Night / Sleep Over / NA | No | repeated identically across 4 grid cells — merged-cell artifact, one logical field |
| BOC current | checkbox group | L / M / H / NA | No | "BOC" = Behaviour(s) of Concern |
| BOC 5yrs+ | checkbox group | L / M / H / NA | No | |
| BEHAVIOUR MGNT PLAN | checkbox group | Y / N / NA | No | |
| — PLAN PROVIDED | checkbox group | Y / N | No | sub-field, appears twice (merged-cell artifact) |
| REG RESTRICTIVE PRACTICES | checkbox group | Y / N / NA | No | |
| — LODGED ON RIDS | checkbox group | Y / N | No | appears 3x (merged-cell artifact) |
| EPILEPSY PLAN | checkbox group | Y / N / NA | No | |
| — PLAN PROVIDED (epilepsy) | checkbox group | Y / N | No | |
| — PRN | checkbox group | Y / N | No | |
| DIABETES PLAN | checkbox group | Y / N / NA | No | |
| — PLAN PROVIDED (diabetes) | checkbox group | Y / N | No | |
| COMPLEX BOWEL PLAN | checkbox group | Y / N / NA | No | |
| — PLAN PROVIDED (bowel) | checkbox group | Y / N | No | |
| ……………………..PLAN (blank/custom plan name) | checkbox group | Y / N / NA | No | literal ellipsis placeholder in source — a fill-in-the-blank plan name |
| — PLAN PROVIDED (custom) | checkbox group | Y / N | No | |
| COMPLEX WOUND CARE PLAN | checkbox group | Y / N / NA | No | |
| — PLAN PROVIDED (wound) | checkbox group | Y / N | No | |
| ASTHMA MGNT PLAN | checkbox group | Y / N / NA | No | |
| — PLAN PROVIDED (asthma) | checkbox group | Y / N | No | |
| HEALTH MGNT PLAN | checkbox group | Y / N / NA | No | |
| — PLAN PROVIDED (health) | checkbox group | Y / N | No | |

#### Table 4 — Equipment / diet / support notes (23 rows, 10 cols)

Columns 2–10 repeat identical header content per row — a merged-cell artifact; treated as one logical field per row below.

| Field label | Control type | Options | Required marker? | Notes |
|---|---|---|---|---|
| EQUIPMENT | checkbox (multi-select) + Y/N | HI-LO Bed, Hoist, Shower chair, Commode, Walker, Standing Machine | No | |
| WHEELCHAIR | Y/N + free labels | Travel in Vehicle / Transfers in Vehicle / Weight bare / Out and About | No | the four sub-labels have no checkbox glyphs in source — likely free-text annotation slots, not selectable options |
| MODIFIED DIET | checkbox (multi-select) + Y/N | A (Soft), B (minced), C (pureed), Cut small | No | |
| THICKENED | checkbox (multi-select) + Y/N | Mild (nectar), Moderate (yoghurt), Extreme (pudding) | No | |
| DIABETIC | checkbox | Y / N | No | |
| BOWEL CARE | checkbox | Y / N | No | |
| COLOSTOMY | checkbox | Y / N | No | |
| PEG FEED | checkbox | Y / N | No | appears twice (merged-cell artifact) |
| CATHETER | checkbox | Y / N | No | |
| CONTENANCE SUPPORT | long text | — | No | sic — "Contenance" in source (typo for Continence) |
| PERSONAL CARE SUPPORT | long text | — | No | |
| HEALTH CONDITIONS/DIAGNOSES | long text | — | No | |
| FOLLOW UP REQUIRED | checkbox/long text | REFER TO NURSE PRACTITIONER FOR ASSESSMENT (Y/N implied) | No | label "YES/NO" present but not bound to a rendered checkbox glyph |
| PREFERRED TRIP/ACTIVITIES | long text | — | No | |
| EXPRESSIVE AND RECEPTIVE SKILLS | long text | — | No | |
| STRENGTHS/FEARS | long text | — | No | |
| GOALS | long text | — | No | followed by 11 blank spacer rows, presumably overflow space for the Goals text |
| Completed by Oassist Person | text (signature-adjacent) | — | No | |
| Date (completion) | date | — | No | on same row as "Completed by" |

#### Table 5 — CULTURAL/PERSONAL CONSIDERATIONS (6 rows, 6 cols)

| Field label | Control type | Options | Required marker? | Notes |
|---|---|---|---|---|
| CALD | checkbox | CALD / NA | No | |
| LGBTIQA+ | checkbox | LGBTIQA+ / NA | No | |
| FAMILY/COMMUNITY | checkbox | (value) / NA | No | |
| ATSI | checkbox | ATSI / NA | No | repeated 3x (merged-cell artifact) |
| RIGHTS AND RESPONSIBILITIES — Received | checkbox | Y / N | No | |
| PRIVACY AND CONFIDENTIALITY — Received | checkbox | Y / N | No | repeated 3x (merged-cell artifact) |
| FEEDBACK INFO AND FORM — Received | checkbox | Y / N | No | |
| BEING SAFE INFO — Received | checkbox | Y / N | No | repeated 3x (merged-cell artifact) |
| ADVOCACY INFO — Received | checkbox | Y / N | No | |
| CLIENT/REPRESENTATIVE | signature | — | No | name line |
| SIGNATURE | signature | — | No | |
| DATE | date | — | No | |

### Free-text instructions / consent wording
None found. This document has no consent/privacy paragraph text anywhere in the body — only the "Received Y/N" acknowledgement checkboxes listed above (Rights & Responsibilities, Privacy & Confidentiality, Feedback info, Being Safe info, Advocacy info). The underlying documents referenced (e.g. the privacy policy itself) are not quoted here.

---

## CLIENT OVERVIEW FORM Mastercopy.docx

### Purpose
A condensed, printable "cheat sheet" summarising one participant's critical support needs (personal care, night support, diet, medication, behaviours of concern, restrictive practices, health alerts) for a specific trip/outing — the header reads "CLIENT SUPPORT NEEDS SUMMARY | TRIP | DATE | GROUP", confirming this is a per-trip staff briefing sheet derived from the fuller profile, not a primary data-entry form.

**This source file is a filled example for a real, named participant, not a blank template** — see the PHI notice at the top of this document. Values below are structural field labels only; the actual filled content (name, diagnosis narrative, behavioural detail) has been redacted.

### Sections, in document order

Single table (14 rows, 5 cols; columns 3–5 repeat identical content — merged-cell artifact, one logical value column).

| Field label | Control type | Options | Required marker? | Notes |
|---|---|---|---|---|
| NAME | text | — | No | value redacted (PHI) |
| (unlabelled second line under NAME) | long text | — | No | free-text diagnosis/condition summary; value redacted (PHI) |
| PERSONAL CARE | long text | — | No | assistance-level description; value redacted |
| CONTENANCE SUPPORT/Night | long text | — | No | sic — "Contenance"; value redacted |
| Night Support | text | — | No | e.g. type of overnight support; value redacted |
| MODIFIED FOOD | long text | Options referenced: A (Soft), B (minced), C (pureed) | No | value redacted |
| THICKENED | long text | Options referenced: Mild (nectar), Moderate (yoghurt), Extreme (pudding) | No | value redacted |
| How I take my Medication | long text | — | No | references a separate "Meal time Manag. plan"; value redacted |
| BEHAVE OF CONCERN | text/long text | Yes/No implied + reference to BSP | No | value redacted |
| Current / BOC 5yrs+ | radio group | Low / Med / High / Critical | No | two related risk ratings on one row |
| (unlabelled continuation row) | long text | — | No | detailed behavioural narrative; value redacted (PHI) — this is the row that most clearly carries identifying clinical detail |
| HEALTH CONDITIONS ALERTS | long text | — | No | value redacted |
| NIGHT TIME SLEEP PATTERN | long text | — | No | empty in source |
| RESTRICTIVE PRACTICE (RP) | text + checkbox group | Authorised RP / Unauthorised RP (n/a shown); sub-groups: Routine and PRN, each with Chemical / Environmental / Mechanical / Physical / Seclusion | No | two parallel checkbox groups (Routine vs PRN) over the same five restrictive-practice categories |

### Free-text instructions / consent wording
None — this is a summary sheet, not a consent-bearing form.

---

## Oassist Participant Profile V2026.docx

### Purpose
The full participant profile intended to also double as a holiday/short-term-accommodation (STA) booking form — it covers identity/contacts, cultural considerations, NDIS plan and key identifiers, choice & control, support ratios, diagnoses, functional/personal-care/continence/cognitive/communication assessment, daily routine, dietary needs, ADLs, and then a distinct **holiday-specific consent and terms & conditions block** (travel insurance, alcohol consent, OTC medication, emergency medical treatment, cancellation fees, luggage limits). No numbered sections; headings are plain paragraph text above each table. Title paragraph at top: "Participant Profile", with "Date Completed:" / "Completed by:" fields directly beneath.

### Sections, in document order

**Header fields**

| Field label | Control type | Options | Required marker? | Notes |
|---|---|---|---|---|
| Date Completed | date | — | No | |
| Completed by | text | — | No | |

**Participant/contact table (12 rows, 3 cols)**

| Field label | Control type | Options | Required marker? | Notes |
|---|---|---|---|---|
| Participants Full Name | text | — | No | |
| Address | text | — | No | |
| Contact Numbers | text | — | No | |
| Other Contact Name | text | — | No | |
| Contact Email | text | — | No | |
| DOB | date | — | No | |
| Gender | text | — | No | free text, not a dropdown in source |
| Living Situation | text | — | No | |
| Next of Kin/Emergency Contact | table-repeater (2 columns of the same sub-fields) | sub-fields: Name, Relationship, Phone, Email, Address | No | two contact slots side by side |
| Financial Administrator | table-repeater | sub-fields: Name, Phone, Address, Email | No | two slots |
| Nominated Decision Maker | table-repeater | sub-fields: Name, Relationship, Phone, Email, Address | No | two slots |
| What is your preferred communication style? | long text | — | No | |

**CULTURAL AND PERSONAL CONSIDERATIONS** (instruction: "Please indicate below whether we have addressed your rights and responsibilities and have provided you the information listed in the below table.")

| Field label | Control type | Options | Required marker? | Notes |
|---|---|---|---|---|
| CALD | checkbox | (blank) / NA | No | |
| LGBTQI | checkbox | (blank) / NA | No | note: spelled "LGBTQI" here vs "LGBTIQA+" in the Intake form |
| FAMILY/COMMUNITY | checkbox | (blank) / NA | No | |
| ATSI | checkbox | (blank) / NA | No | |
| RIGHTS AND RESPONSIBILITIES — Received | checkbox | Y / N | No | |
| FEEDBACK AND INFO FORM — Received | checkbox | Y / N | No | |
| PRIVACY AND CONFIDENTIALITY — Received | checkbox | Y / N | No | |
| BEING SAFE INFO — Received | checkbox | Y / N | No | |
| ADVOCACY — Received | checkbox | Y / N | No | |
| CLIENT/REPRESENTATIVE | signature | — | No | |
| SIGNATURE | signature | — | No | |
| DATE | date | — | No | |

**NDIS Plan Information or DSOA** (mutually-exclusive content-control checkbox at the section header)

| Field label | Control type | Options | Required marker? | Notes |
|---|---|---|---|---|
| NDIS Plan Information / DSOA | checkbox (content control), select-one intent | NDIS Plan Information / DSOA | No | choice of which plan type this section describes |
| Plan Number | text | — | No | |
| Plan dates | date range | — | No | |
| Review date | date | — | No | |
| Plan Type | checkbox group, select-one intent | Plan / Agency / Self | No | |
| Support Coordinator | text group | Name, Phone, Email | No | |
| Plan Manager | text group | Name, Phone, Email | No | |
| Plan Nominee | text group | Name, Phone, Email | No | |

**Key Identifiers**

| Field label | Control type | Options | Required marker? | Notes |
|---|---|---|---|---|
| Pension # and expiry | text | — | No | |
| Medicare # and expiry | text | — | No | |
| Companion Card # and expiry | text | — | No | |
| Private Health | text group | Name, Membership # | No | |
| Taxi Card # | text | — | No | |
| Hair and Eye colour | text | — | No | |
| Weight (kg) | text/number | — | No | |
| Height (cm) | text/number | — | No | |

**Participant Choice and Control**

| Field label | Control type | Options | Required marker? | Notes |
|---|---|---|---|---|
| Support areas | long text | — | No | |
| Goals | long text | — | No | |
| Strengths Fears? | long text | — | No | |

**Support Ratio / Night Support**

| Field label | Control type | Options | Required marker? | Notes |
|---|---|---|---|---|
| Support ratio | radio group | 1:1, 2:1, 1:2, 1:3, 1:4, 1:5 | No | |
| Time of day per ratio | checkbox (multi-select) | Morning, Day, Evening | No | one set per ratio row |
| Night Support | checkbox, select-one intent | Active Night / S/O (sleepover) | No | |

**Diagnoses & Medical Conditions (12 rows, 4 cols)**

| Field label | Control type | Options | Required marker? | Notes |
|---|---|---|---|---|
| Intellectual Disability | checkbox group | Yes/No, Mild/Moderate/Severe/ABI | No | plus free-text Comments |
| Visual Impairment | checkbox group | None/Mild/Moderate/Profound, Wears Glasses/Aids, Yes/No | No | plus "If yes, please specify" text |
| Hearing Impairment | checkbox group | None/Mild/Moderate/Profound, Aids Left/Right, Sign Yes/No (specify) | No | plus "If yes, please specify" text |
| Mental Health / High Blood Pressure / Wound Care | checkbox group (3 combined conditions in one row) | Yes/No per condition | No | Wound Care sub-row references a nested "HIDPA" table; "Oassist Staff Training Required? Yes/No" |
| Epilepsy | checkbox group | Yes/No; Frequency: Petit/Absence/Grand Mal; Medical response Chart Yes/No; Plan provided Yes/No; PRN Yes/No; Approved by (Neurologist) | No | row repeated 4x with slightly different trailing fields (last date, HIDPA nested table, training required) — appears to allow multiple epilepsy-related entries |
| Diabetes | checkbox group | Yes/No; Type 1/Type 2; Plan provided Yes/No; Medication type (text); BGL Tester (checkbox); Approved by (GP); Subcutaneous Injections / Insulin Pen / Oral medication (checkbox multi-select) | No | row repeated 2x |
| Asthma | checkbox group | Yes/No; Plan provided Yes/No | No | plus Comments text |
| Medium–Severe Dysphasia | checkbox group | Yes/No; Speech Report Provided Yes/No; HIDPA nested table; Oassist Staff Training Required Yes/No | No | sic — likely means Dysphagia |

**Client Functional Information (12 rows, 7 cols)**

| Field label | Control type | Options | Required marker? | Notes |
|---|---|---|---|---|
| Physical Limitations — No Limitations | checkbox | Yes/No implied | No | |
| Physical Limitations — Ambulant | checkbox group | No Assist / Unsteady / Frame / Short Distance | No | plus free-text Comments / Falls Risk |
| Physical Limitations — Ambulant risk rating | radio group | Low / Med / High / Crit | No | |
| Physical Limitations — Non Ambulant | checkbox (multi-select) | Wheelchair in vehicle, Full Vehicle, Transfers in vehicle, Ceiling hoist, Manual hoist, Sit to stand, Slide board/sheet, Walking aid, Standing frame | No | plus Comments |
| Physical Limitations — Issues with uneven ground | checkbox | Yes/No | No | |
| Level of Personal Care | checkbox (multi-select), select-one intent | Independent, Supervision only, One person assisted transfer, Two person assisted transfer | No | plus Comments |
| Orthotics (braces/splints/prosthetics) | checkbox | Yes / No / Plan | No | plus "If yes, please list" |
| Continence Support | checkbox | Yes / NA / Plan | No | |
| Continence Support — assistance type | checkbox | Prompt only / Assist | No | |
| Continence Support — aids | checkbox (multi-select) | Continence aids, Pull up (when), Pads (when) | No | |
| Continence Support — night | checkbox + text | Night support required (free text) | No | |
| Colostomy / Catheter / Enema / Suppository | checkbox (multi-select) | Yes / No / Plan | No | plus "Support plan provided Yes/No", free-text support-required detail, HIDPA nested table, staff training required Yes/No |
| Menstruation Support | checkbox | Yes / No / Plan | No | plus Independent / Verbal prompts / Physical assistance (checkbox) |

**Cognitive and behavioural (12 rows, 9 cols)**

| Field label | Control type | Options | Required marker? | Notes |
|---|---|---|---|---|
| Memory | checkbox | Excellent / Fair / Poor | No | plus Comment |
| Memory Aids used | checkbox | Yes / No | No | plus Comment |
| Impaired understanding | checkbox | Yes / No | No | plus Comment |
| Impaired Judgement and Reasoning | checkbox | Yes / No | No | plus Comment |
| Behaviours of Concern (Current) | checkbox | Yes / No | No | plus Comment |
| Reg Restrictive Practice — category | checkbox (multi-select) | Chemical Routine, Chemical PRN, Physical/Mechanical, Other | No | plus Comments |
| Reg Restrictive Practice — RIDS Logged | checkbox | Yes / No | No | |
| Reg Restrictive Practice — BSP Plan provided | checkbox | Yes / No | No | |
| Reg Restrictive Practice — BOC Chart | checkbox | Yes / No | No | |
| Reg Restrictive Practice — Risk Assessment (5 years ago) | radio group | Low / Medium / High / Critical | No | |
| Reg Restrictive Practice — Risk Assessment (Current) | radio group | Low / Medium / High / Critical | No | |

**Communication/Sensory Limitation/Understanding**

| Field label | Control type | Options | Required marker? | Notes |
|---|---|---|---|---|
| Expressive Skills | checkbox group | High/Medium/Low; Verbal/Non-verbal/Restrictions/Sign (specify) | No | |
| Receptive Skills | checkbox | High / Medium / Low | No | plus Comment |
| Reading | checkbox | Yes/No; if Yes: Good/Med/Low | No | |
| Aids used | checkbox | Yes / No | No | plus "if yes, please specify" |

**Daily Routine summary**

| Field label | Control type | Options | Required marker? | Notes |
|---|---|---|---|---|
| Morning (wake up time) / Evening (preferred bed time) | text | — | No | single free-text cell covering both prompts |

**Dietary Requirements (12 rows, 6 cols)**

| Field label | Control type | Options | Required marker? | Notes |
|---|---|---|---|---|
| Meal assistance | checkbox | Yes / No | No | plus Comments |
| Fluid intake | checkbox + risk | Yes/No, Risk Choking (text); Chart Yes/No; risk rating Low/Medium/High/Critical | No | |
| Modified Diet | checkbox + risk | Yes/No, Risk Choking (text); Plan Yes/No; risk rating Low/Medium/High/Critical | No | |
| PEG regime | checkbox | Plan provided Yes/No | No | plus Comments, HIDPA nested table, staff training required |
| Special utensils required | checkbox | Yes / No | No | plus Comments |
| Special Dietary Needs | checkbox + risk | Yes/No; Risk Allergies/Intolerances (text); risk rating Low/Medium/High/Critical | No | |
| Other Allergies/Alerts | text + risk | Response (text); Risk rating Low/Medium/High/Critical | No | |
| Allergies/alerts | long text | — | No | in separate small table further down |
| Foods I will always eat | long text | — | No | |
| Eating out — what works for me | long text | — | No | |

**Snapshot of favourite meals (example row baked into template)**

| Field label | Control type | Options | Required marker? | Notes |
|---|---|---|---|---|
| Breakfast / Medication / Lunch / Medication / Dinner / Medication | long text (table-repeater, 6 columns) | — | No | the template ships with a filled example row (e.g. "6 Weetbix/milk/sugar…") to illustrate the level of detail expected — generic example, not participant PHI |
| Tricks you use if the participant will not/does not take medication | long text | — | No | |
| Foods I will always eat | long text | — | No | duplicate label also appears in the small table above |

**Personal Activities of Daily Living (8 rows, 3 cols)**

| Field label | Control type | Options | Required marker? | Notes |
|---|---|---|---|---|
| Dressing | radio group | I (Independent) / S (Supervision) / A (Assistance) / F (Full support) | No | plus free-text "Specific instructions" |
| Bathing/Showering | radio group | I / S / A / F | No | |
| Oral Care | radio group | I / S / A / F | No | |
| Grooming | radio group | I / S / A / F | No | |
| Toileting/Bowel Care | radio group | I / S / A / F | No | plus "Chart Yes/No" |
| Medication Administration | radio group | I / S / A / F | No | |
| Other (free-label) | radio group | I / S / A / F | No | |

**Personal and Cultural Preferences**

| Field label | Control type | Options | Required marker? | Notes |
|---|---|---|---|---|
| Things the person would like support with | long text | — | No | |
| Things you need to know when working with participant | long text | — | No | |
| Who and what is important to participant | long text | — | No | |
| Things participant enjoys doing (hobbies/interests) | long text | — | No | |
| Likes and dislikes | long text | — | No | |

**Community and Domestic activities of daily living (18 rows, 7 cols)**

| Field label | Control type | Options | Required marker? | Notes |
|---|---|---|---|---|
| Community Access | radio group | I / S / A / F | No | plus "Specific instructions" |
| Socialising | radio group | I / S / A / F | No | |
| Money Handling | radio group | I / S / A / F | No | |
| Attending Appointments | radio group | I / S / A / F | No | |
| Work / Study | radio group | I / S / A / F | No | |
| Transportation | checkbox + risk | Yes/No; Specific Instructions (seatbelt/flight risk text); risk rating Low/Medium/High/Critical | No | |
| Does the person use taxis or public transport? | checkbox + risk | Yes/No; "what assistance is required" text; risk rating Low/Medium/High/Critical | No | |
| Road Awareness | checkbox | Yes / No | No | |
| Kitchen — Cooking/Food Prep/hot drinks | radio group | I / S / A / F | No | |
| Laundry | radio group | I / S / A / F | No | |
| Cleaning rooms | radio group | I / S / A / F | No | |
| Gardening/Maintenance | radio group | I / S / A / F | No | |
| Shopping — Personal/Grocery | radio group | I / S / A / F | No | |
| Banking/Budgeting | radio group | I / S / A / F | No | |
| Other (free-label) | text | — | No | |

**Risk Category Table** (reference matrix, not a data-entry field — Likelihood × Consequence → Low/Medium/High/Critical rating lookup table used elsewhere in the form)

### Free-text instructions / consent wording (verbatim)

> "Consent and terms
> Oassist take images and video during the holiday and reserve the right to use these in promotional material unless requested otherwise by the participant. No names will be published.
> I am aware that the participant will be photographed and use of photographs for display, publication, and advertising for Oassist. Where a signature is absent Oassist assume approval is given unless Oassist receives in writing to state otherwise.
>
> We collect information about the participant for the primary purpose of providing quality supports and services to them.
> We need to collect some personal information from the participant to ensure our services meet their needs. If you do not provide this information, we may be unable to fully provide these services. This information will also be used for:
> a. administrative purposes for running our service
> b. billing you directly, through the NDIS, or other agency if required
> c. use within our service to ensure you are provided with quality supports and services
> d. disclosure of information to the NDIA, the NDIS Quality and Safeguards Commission, or other government agencies if needed
> e. disclosure of information to health professionals to ensure high quality health care for you if needed
> f. disclosure to other providers, with your consent, in order to provide appropriate services includes training of Oassist Staff in identified HIDPA supports.
>
> We do not disclose your personal information to overseas recipients.
>
> We have a privacy policy that is available on request. That policy provides guidelines on the collection, use, disclosure, and security of your information.
>
> To ensure the process of quality supports and services, information about you may be given to other service providers who also provide you services.
> I : ____________________________________
> have read the above information and understand the reasons for the collection of my personal information and the ways in which the information may be used and disclosed and I agree to that use and disclosure
> understand that it is my choice as to what information I provide, and that withholding or falsifying information may act against the best interests of the supports and services I receive
> am aware that I can access my personal information and shift notes on request and if necessary, correct any information I believe to be inaccurate
> understand that if, in exceptional circumstances, access is denied for legitimate purposes, that the reasons for this and possible remedies will be made available to me
> have been provided with or have been given an opportunity to obtain a copy of the privacy policy.
> Have the right to withdraw consent and understand that it may act against the best interests of the supports and services I receive
>
> Guardian/Carer Signature: ___________________Participant Signature: _________________
>
> Consent for the participant to have an alcoholic drink on an outing/holiday in an appropriate setting.
> ☐Yes ☐No Guardian/Carer Signature: _________________________
> ☐Yes ☐No Participant Signature: _________________________
>
> Non Prescribed Over the Counter Medication
> I/We the undersigned confirm that the participant is / is not able to be administered Paracetamol for the treatment of minor ailments if required (dose as per package or container prescription and used strictly as directed).
>
> Medical Treatment in the Event of an Emergency
> In the event of such an emergency requiring immediate medical attention, we the undersigned, give permission for a legally qualified medical officer to treat the participant.
> I/We the undersigned, confirm that the Health and Medical details pertaining to the participant as completed in this Booking Application Form are true and correct and any known contra-indications or concerns regarding administration of medication and general health have been detailed.
>
> TERMS & CONDITIONS For Holidays and Short-Term Accommodation
> All medication must be in Webster packs in good condition. Preferred photo attached.
> PRN medication that requires approval before administering is not always possible due to remote locations or time. Please discuss this with Oassist Staff or send information of situation and signs of when this should be given.
> All participants on medication, MUST carry 3 days extra medication.
> Where a District Nurse maybe called into administer Insulin or perform other required medical care this will be billed separately for payment by the participant.
> Where HIDPA supports are identified, this will be billed separately for payment by the participant for required Oassist staff training.
> Luggage maximum weight is 16kg per passenger, Small Wheelie suitcases preferred.
> All monies/ Balance and forms are due 90 days before departure date of short breaks.
> Cancellation fees do apply, refer to Terms and Conditions section.
> When the Oassist Participant Form and Medical Consent Form has not been signed by the participant, participant's next of kin, legal guardian, or carer, Oassist considers automatic acceptance by the participant upon receipt of payment invoice or acceptance of service agreement sent via email or mail.
> Oassist participants are required to take out travel insurance as a condition of participation in our holiday tours. You can apply for this from any insurance company or Oassist will organise this on your behalf.
> Cancellation charges from out of pocket expenses do apply if a participant cancels their holiday. Notice of cancellation must be made in writing to Oassist. Cancellation fees are:
> 100% fee for 0-30 days prior to travel
> 50% fee for 31-60 days prior to travel
> $100 fee for over 61 days prior to travel
> Oassist reserves the right to:
> Alter or modify itineraries as deemed necessary.
> Alter tour costs if necessary.
> Cancel a tour if minimum participant's numbers have not been met. (If a tour is cancelled all monies paid will be refunded to the participant or transferred to an alternative holiday as chosen by the participant).
> The price of the tours includes all meals, accommodation, entry fees, transport as per itinerary and staff support, an active night required will be charged at a higher rate.
> NOT included in the tour price is: - participant spending money; -transfers to and from departure point if any; cost of passports, visas etc.; & items of personal nature such as laundry, toiletries, telephone, excess baggage, wheelchair rental, aid rentals, morning/afternoon teas and drinks if out and about.
> Oassist reserves the right to withdraw holiday participation from anyone whose behaviour is likely to affect the smooth operation of the tour or adversely affect the enjoyment or safety of other participant and Oassist shall be under no liability to such person. A participant is liable for any damage to property or persons they may cause. If a participant needs to be sent home early, the participant or guardian will bear the full cost of the participant's return, including staff cost, transport, accommodation, and all other support costs. No part of the tour fare will be used for the participant's return, as all Oassist costs must be met. No refund will be made available for early return of participants from a Oassist trip due to medical or BOC issues.
> All personal belongings are the responsibility of the participant therefore Oassist are not liable for replacement costs if lost or damaged.
> Oassist take images and video during the holiday and reserve the right to use these in promotional material unless requested in writing otherwise by the participant. Oassist will provide photos and a verbal summary for the participant for all short breaks and photos for day trips.
>
> I/We have read and understand the above Oassist terms and conditions, and I/We agree with the stated terms and conditions. I/We have been informed about travel insurance and have:
> Accepted travel insurance ☐ Declined travel insurance ☐"

Trailing signature block: Participant/Guardian/Carer Name, relationship/role (if signing on behalf of participant), Signature, Date.

---

## Oassist_Participant_Profile_Community_Access_V2026.docx

### Purpose
A community-access-focused participant profile and risk assessment. Header: "Oassist Participant Profile – Community Access & Risk Assessment | V2026"; footer carries Oassist's phone/email/website. Unlike the general Profile V2026 document, this one is organised into 11 explicit numbered sections and is narrower in scope — no NDIS-plan/key-identifiers/financial-administrator content, and no holiday-specific T&Cs — instead its distinguishing content is a structured **Community Access Risk Assessment** (Road & Traffic Safety, Behaviours of Concern, Health & Personal Safety categories rated Low/Med/High/Crit) plus a shorter, community-access-scoped consent block.

### Sections, in document order

**Header fields**

| Field label | Control type | Options | Required marker? | Notes |
|---|---|---|---|---|
| Date completed | date | — | No | |
| Completed by | text | — | No | |
| Review date | date | — | No | |

**1. PARTICIPANT DETAILS**

| Field label | Control type | Options | Required marker? | Notes |
|---|---|---|---|---|
| Full name | text | — | No | |
| Preferred name | text | — | No | |
| Date of birth | date | — | No | |
| NDIS number | text | — | No | |
| Address | text | — | No | |
| Contact number | text | — | No | |
| Email | text | — | No | |
| Living situation | text | — | No | |
| Emergency Contact/Next of Kin — Name | text | — | No | |
| Emergency Contact/Next of Kin — Relationship | text | — | No | |
| Emergency Contact/Next of Kin — Phone | text | — | No | |
| Medicare # | text | — | No | |
| Pension # | text | — | No | |
| Companion Card # | text | — | No | |
| Preferred communication style | long text | — | No | |

**2. DIAGNOSIS** (checkbox grid, 4 rows × 3 cols)

| Field label | Control type | Options | Required marker? | Notes |
|---|---|---|---|---|
| Diagnosis (multi-select) | checkbox | Intellectual Disability, Mental Health, Autism (ASD), Vision Impairment, Hearing Impairment, Epilepsy, Diabetes, Asthma, Dysphagia, Acquired Brain Injury, Physical Disability, Other (specify below) | No | single consolidated checklist — not present in this exact form elsewhere |
| Other / details | long text | — | No | |

**3. HIDPA (High Intensity Daily Personal Activities)** — instruction: "Tick all that apply."

| Field label | Control type | Options | Required marker? | Notes |
|---|---|---|---|---|
| HIDPA (multi-select) | checkbox | PEG/enteral feeding, Severe dysphagia, Ventilator support, Tracheostomy care, Urinary catheter, Bowel care/enema/suppository, Stoma/colostomy, Subcutaneous injections, Complex wound care, Diabetes management (insulin), Epilepsy/seizure management, Pressure care, High intensity behaviour support, Medication administration (complex), None of the above | No | |
| HIDPA notes | long text | — | No | |

**4. PERSONAL CARE** — legend: "I = Independent, S = Supervision/prompting, A = Assistance, F = Full support"

| Field label | Control type | Options | Required marker? | Notes |
|---|---|---|---|---|
| Dressing | radio group | I / S / A / F | No | plus "How to help me" point-form text |
| Showering/bathing | radio group | I / S / A / F | No | |
| Oral care | radio group | I / S / A / F | No | |
| Grooming | radio group | I / S / A / F | No | |
| Toileting | radio group | I / S / A / F | No | |
| Medication | radio group | I / S / A / F | No | |
| Transfers/mobility | radio group | I / S / A / F | No | |

**5. CONTINENCE SUPPORT**

| Field label | Control type | Options | Required marker? | Notes |
|---|---|---|---|---|
| Continence support required? | checkbox | Yes / No | No | |
| Continence plan provided? | checkbox | Yes / No | No | |
| Continence type (multi-select) | checkbox | Prompt only, Physical assistance, Pads, Pull-ups, Catheter, Stoma/colostomy, Bowel program, Night support required, Independent | No | |
| How to help me (incl. toileting in the community — access needs, timing, discreet prompts) | long text | — | No | multi-line free text area |

**6. MEAL SUPPORT**

| Field label | Control type | Options | Required marker? | Notes |
|---|---|---|---|---|
| Mealtime assistance? | checkbox | Y / N | No | |
| Choking risk? | checkbox | Y / N | No | |
| Modified diet? | checkbox | Y / N | No | |
| Mealtime plan? | checkbox | Y / N | No | |
| Diet type (multi-select) | checkbox | Regular diet, Soft/minced, Pureed, Thickened fluids (level: ___), Special utensils, PEG feed, Allergies/intolerances, Cut into bite sizes, Full physical assistance | No | |
| Allergies/alerts | long text | — | No | |
| Foods I will always eat | long text | — | No | |
| Eating out — what works for me | long text | — | No | |

**7. COMMUNITY ACCESS — ABOUT ME**

| Field label | Control type | Options | Required marker? | Notes |
|---|---|---|---|---|
| My goals for community access | long text | — | No | |
| Activities I enjoy / places I like to go | long text | — | No | |
| Things I do not like / avoid | long text | — | No | |
| What is important to me / who is important to me | long text | — | No | |
| Signs I am happy and settled | long text | — | No | |
| What helps me calm down | long text | — | No | |
| Mobility/community risk flags (multi-select) | checkbox | Uses wheelchair, Wheelchair accessible vehicle required, Walking frame/aids, Issues with uneven ground, Falls risk, Fatigues easily — needs rest breaks, Seatbelt must be checked, Sensory sensitivities (noise/crowds), Communication aid/device used | No | |

**8. BEHAVIOURS OF CONCERN (BOC)**

| Field label | Control type | Options | Required marker? | Notes |
|---|---|---|---|---|
| Current BOC? | checkbox | Yes / No | No | |
| BSP provided? | checkbox | Yes / No | No | |
| Restrictive practice? | checkbox | Yes / No | No | |
| Behaviours that may present in the community (multi-select) | checkbox | Harm to self, Harm to others, Property damage, Absconding/running away, Verbal aggression/yelling, Physical aggression (hit, kick, bite, spit), Refusal to move/transition, Inappropriate public behaviour, Taking others' property, Removing clothing in public, Removing seatbelt in vehicle, Other (specify below) | No | |
| Triggers | long text | — | No | |
| Early warning signs | long text | — | No | |
| What works — de-escalation | long text | — | No | |
| What NOT to do | long text | — | No | |

**9. WHAT MY SUPPORTS LOOK LIKE** — instruction: "Only complete the sections where Oassist staff are providing support. Leave the others blank."

| Field label | Control type | Options | Required marker? | Notes |
|---|---|---|---|---|
| My MORNING supports look like… | long text | — | No | multi-line area |
| My DAY supports look like… | long text | — | No | multi-line area |
| My AFTERNOON/EVENING supports look like… | long text | — | No | multi-line area |
| My OVERNIGHT supports look like… | checkbox + long text | Active night / Sleepover / N/A | No | |

**10. COMMUNITY ACCESS RISK ASSESSMENT** — instruction: "Rate each risk below using the table above. Tick one rating per line and record the control/strategy."

*ROAD & TRAFFIC SAFETY*

| Field label | Control type | Options | Required marker? | Notes |
|---|---|---|---|---|
| General Road awareness | radio group | Low / Med / High / Crit | No | plus free-text Support/Strategy column |
| Runs across roads / bolts into traffic | radio group | Low / Med / High / Crit | No | |
| Absconding/flight risk in the community | radio group | Low / Med / High / Crit | No | |
| Wanders or gets lost in crowds/large venues | radio group | Low / Med / High / Crit | No | |
| Removes seatbelt/opens door while vehicle moving | radio group | Low / Med / High / Crit | No | |

*BEHAVIOURS OF CONCERN (risk matrix)*

| Field label | Control type | Options | Required marker? | Notes |
|---|---|---|---|---|
| Harm to self (hits self, head banging, scratching) | radio group | Low / Med / High / Crit | No | plus Support/Strategy text |
| Harm to others (hits, kicks, bites, spits, pushes) | radio group | Low / Med / High / Crit | No | |
| Break items / throws objects | radio group | Low / Med / High / Crit | No | |
| Property damage (windows, walls, cars, furniture) | radio group | Low / Med / High / Crit | No | |
| Verbal aggression/yelling in public | radio group | Low / Med / High / Crit | No | |
| Refusal to return to vehicle/transition refusal | radio group | Low / Med / High / Crit | No | |
| Inappropriate public behaviour | radio group | Low / Med / High / Crit | No | |
| Taking food or items belonging to others | radio group | Low / Med / High / Crit | No | |

*HEALTH & PERSONAL SAFETY*

| Field label | Control type | Options | Required marker? | Notes |
|---|---|---|---|---|
| Choking / eating and drinking in the community | radio group | Low / Med / High / Crit | No | plus Support/Strategy text |
| Seizure in the community | radio group | Low / Med / High / Crit | No | |
| Diabetes — hypo/hyper event | radio group | Low / Med / High / Crit | No | |
| Asthma / breathing difficulty | radio group | Low / Med / High / Crit | No | |
| Allergy or anaphylaxis exposure | radio group | Low / Med / High / Crit | No | |
| Falls — uneven ground, stairs, fatigue | radio group | Low / Med / High / Crit | No | |
| Continence accident while out | radio group | Low / Med / High / Crit | No | |
| Heat/sun exposure | radio group | Low / Med / High / Crit | No | |
| Water safety (pool, beach, river) | radio group | Low / Med / High / Crit | No | |

*COMMUNITY & SOCIAL* (heading present, no populated risk rows extracted beyond the additional-risks free text below — the category heading exists but the corresponding rated-item table was not present in the source, unlike the three categories above)

| Field label | Control type | Options | Required marker? | Notes |
|---|---|---|---|---|
| Additional risks not listed above | long text | — | No | multi-line area |
| Overall community access risk rating | radio group | Low / Medium / High / Critical | No | |

**11. CONSENT & SIGNATURES**

| Field label | Control type | Options | Required marker? | Notes |
|---|---|---|---|---|
| Photos/video consent | radio group (select-one) | I CONSENT to photos/video being used / I DO NOT CONSENT to photos/video being used | No | |
| Privacy acknowledgement | checkbox | I have read and understood the above and consent to the collection and use of this information | No | |
| Privacy policy offer acknowledgement | checkbox | I have been offered a copy of the Oassist privacy policy | No | |
| Emergency medical treatment consent | checkbox | I CONSENT to emergency medical treatment | No | |
| Paracetamol consent | checkbox | Paracetamol may be administered for minor ailments | No | |
| Participant name | text (signature block) | — | No | |
| Participant signature | signature | — | No | |
| Date | date | — | No | |
| Guardian/carer name | text (signature block) | — | No | |
| Guardian/carer signature | signature | — | No | |
| Relationship/role | text | — | No | |

### Free-text instructions / consent wording (verbatim)

> "Photos and media
> Oassist may take photos and video during supports and outings and may use these in promotional material. Consent may be withdrawn in writing at any time.
>
> Privacy and collection of information
> We collect personal information for the primary purpose of providing quality supports and services. It may be used for administration and billing, internal service delivery, disclosure to the NDIA and the NDIS Quality and Safeguards Commission where required, and disclosure to health professionals or other providers with consent. We do not disclose personal information to overseas recipients. Our privacy policy is available on request.
>
> Emergency medical treatment
> In the event of an emergency requiring immediate medical attention, I give permission for a qualified medical practitioner to administer treatment, including transport by ambulance. I confirm the health and medical details in this profile are true and correct."

Also present as an instruction (not consent per se): "Only complete the sections where Oassist staff are providing support. Leave the others blank." (Section 9 preamble.)

---

## Cross-document field map

Legend: X = field/field-group present in that document (label may vary slightly — near-equivalents grouped as one row). "(partial)" = a related but narrower/differently-shaped capture of the same concept.

| Field | Intake (1a) | Client Overview | Profile V2026 | Profile Community Access |
|---|---|---|---|---|
| Full name | X | X | X | X |
| Preferred name | | | | X |
| DOB | X | | X | X |
| Address | X | | X | X |
| Email | X | | X | X |
| Phone/Contact number | X | | X | X |
| NDIS number (participant #) | X | | | X |
| Plan Number (NDIS plan #) | | | X | |
| Gender | | | X | |
| Living situation | | | X | X |
| Preferred communication style | | | X | X |
| Next of Kin/Emergency Contact | | | X | X |
| Financial Administrator | | | X | |
| Nominated Decision Maker | | | X | |
| Support Coordinator (contact) | X | | X | |
| NDIS Funds/Plan Manager (contact) | X | | X | |
| Plan Nominee (contact) | | | X | |
| Residence Contacts | X | | | |
| Family/Other contact | X | | | |
| Administrator contact | X | | | |
| Authorised Signatory contact | X | | | |
| Welfare-check contact (independent living) | X | | | |
| NDIS Funding Y/N | X | | | |
| Plan Type (Self/Agency/Plan) | X | | X | |
| Plan dates (start/finish) | X | | X | |
| Review date | | | X | X (header) |
| Medicare # | | | X | X |
| Pension # | | | X | X |
| Companion Card # | | | X | X |
| Private Health / Taxi Card / Hair-Eye colour / Weight / Height | | | X | |
| CULTURAL/PERSONAL CONSIDERATIONS grid (CALD/LGBTIQA+/Family-Community/ATSI + Rights/Privacy/Feedback/Being-Safe/Advocacy received) | X | | X | |
| Consolidated Diagnosis checklist | | | | X |
| HIDPA checklist (as one section) | | (partial, via nested HIDPA markers) | (partial, via nested HIDPA markers) | X |
| Support ratio | X | | X | |
| Night support type (Active Night/Sleepover/NA) | X | X (partial) | X | X |
| Choice & Control: Support areas / Goals / Strengths-Fears | X (Goals only) | | X | |
| Equipment checklist (Hi-Lo bed, hoist, etc.) | X | | | |
| Wheelchair / mobility-in-vehicle needs | X | | X | |
| Modified diet (soft/minced/pureed/cut small) | X | X | (partial — Yes/No + plan only) | X |
| Thickened fluids (mild/moderate/extreme) | X | X | (partial) | X (level only) |
| Diabetic / Diabetes management | X | | X | X |
| Bowel care / continence support | X | | X | X |
| Colostomy | X | | X | X |
| PEG feed | X | | X (PEG regime) | X (via HIDPA) |
| Catheter | X | | (via Colostomy/Catheter row) | X (via HIDPA) |
| Behaviours of Concern (BOC) — current & risk rating | X | X | X | X |
| Behaviour Management Plan / BSP provided | X | | X | X |
| Regulated Restrictive Practices + RIDS lodged | X | X | X | X |
| Epilepsy plan | X | | X | (partial, checklist only) |
| Asthma plan | X | | X | (partial, checklist only) |
| Complex wound care plan | X | | X | X (checklist) |
| Health conditions/diagnoses (free text) | X | X | (spread across Diagnoses table) | (spread across Diagnosis + HIDPA notes) |
| Personal care support / ADL levels (Dressing, Showering, Oral care, Grooming, Toileting, Medication, Transfers) | (Personal Care Support as one free-text field) | X (Personal Care as one free-text field) | X (as I/S/A/F grid) | X (as I/S/A/F grid) |
| Community/domestic ADLs (money handling, appointments, work/study, shopping, laundry, cleaning, gardening, banking) | | | X | |
| Community access — about me (goals, likes, dislikes, what calms me) | (Preferred Trip/Activities, Strengths/Fears) | | (Personal & Cultural Preferences, partial) | X |
| Communication/expressive-receptive skills | X | | X | (partial, via risk flags only) |
| Cognitive assessment (memory, understanding, judgement) | | | X | |
| Daily routine (morning/evening) | | | X | X (Morning/Day/Afternoon-Evening/Overnight, more granular) |
| Community access risk assessment matrix (road/traffic, BOC, health/safety, rated Low–Critical) | | | (Risk Category lookup matrix only, not itemised risks) | X (fully itemised) |
| Completed by / Date completed | X | | X | X |
| Signature block (participant/guardian) | X (cultural section only) | | X (multiple) | X |
| Photos/video consent | | | X (holiday-specific wording) | X |
| Privacy/collection-of-information consent | (Received Y/N ack. only) | | X (full wording) | X (shorter wording) |
| Emergency medical treatment consent | | | X | X |
| OTC medication (Paracetamol) consent | | | X | X (as single checkbox) |
| Alcohol consent (holiday-specific) | | | X | |
| Travel insurance / holiday T&Cs / cancellation fees | | | X | |

### Field-map counts
- **Intake-only** (appear in Intake 1a and nowhere else): Residence Contacts, Family/Other contact, Administrator contact, Authorised Signatory contact, Welfare-check contact, NDIS Funding Y/N, Equipment checklist — **7 field groups**
- **Profile-only** (appear in Profile V2026 and/or Profile Community Access but not Intake or Client Overview): Preferred name, Gender, Financial Administrator, Nominated Decision Maker, Plan Nominee, Review date, Medicare/Pension/Companion Card #s, Private Health/Taxi Card/Hair-Eye/Weight/Height, Consolidated Diagnosis checklist, HIDPA-as-section, Community/domestic ADLs, Cognitive assessment, Community access risk-assessment matrix, Travel insurance/holiday T&Cs, Alcohol consent — **~15 field groups** (counting each row-cluster above once)
- **Shared/duplicated** (appear in Intake AND at least one Profile document — the de-duplication targets): Full name, DOB, Address, Email, Phone, NDIS number, Living situation, Preferred communication style, Support Coordinator contact, NDIS Funds/Plan Manager contact, Plan Type, Plan dates, Cultural/Personal Considerations grid, Support ratio, Night support type, Modified diet, Thickened fluids, Diabetic, Bowel care, Colostomy, PEG feed, Catheter, BOC, Behaviour Mgmt Plan/BSP, Restrictive Practices/RIDS, Epilepsy plan, Asthma plan, Complex wound care plan, Health conditions free text, Personal care/ADL levels, Communication skills, Completed-by/Date — **~30 field groups**

### 5 biggest shared (Intake + Profile) field groups — de-duplication targets
1. **Regulated Restrictive Practices + RIDS lodged status** — present with near-identical Y/N/checkbox shape in Intake, Client Overview, Profile V2026, and Profile Community Access; the richest/most repeated clinical field group across all four documents.
2. **Behaviours of Concern (current status + severity rating Low/Med/High/Critical)** — present in all four documents, each with a slightly different rating vocabulary (L/M/H/NA vs Low/Med/High/Crit vs Yes/No), a clear normalisation target.
3. **Personal care / ADL support levels** (Dressing, Showering, Oral care, Grooming, Toileting, Medication, Transfers) — free text in Intake/Overview vs a structured I/S/A/F radio grid in both Profile documents; the two profile documents already agree on shape, Intake does not.
4. **Modified diet / thickened fluids classification** (A-soft/B-minced/C-pureed/cut-small; Mild-nectar/Moderate-yoghurt/Extreme-pudding) — present in Intake, Client Overview and Profile Community Access with matching option sets; Profile V2026 only partially captures it (Yes/No + plan, no letter/level codes).
5. **Cultural & rights-information acknowledgement grid** (CALD/LGBTIQA+/Family-Community/ATSI flags + Rights & Responsibilities/Privacy/Feedback/Being-Safe/Advocacy "received Y/N" + client-rep signature) — nearly identical table structure duplicated wholesale between Intake and Profile V2026.

Other large shared groups worth noting even outside the top 5: contact-network fields (name/DOB/address/email/phone), NDIS plan basics (plan type, plan dates), and the epilepsy/asthma/wound-care/diabetes/bowel "plan Y/N + plan provided Y/N" pattern that repeats across Intake and both profile documents with different levels of granularity.
