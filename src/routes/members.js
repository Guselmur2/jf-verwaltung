'use strict';

const express = require('express');
const { db } = require('../db');
const auth = require('../auth');
const audit = require('../audit');
const m = require('../model');
const { parseGermanDate, formatGermanDate } = require('../dates');

const router = express.Router();
const login = auth.requireLogin;

const FIELDS = { name: 'Name', phone: 'Telefon', note: 'Notiz' };

function clean(body) {
  const rawBirthday = (body.birthday || '').trim();
  const iso = parseGermanDate(rawBirthday);
  return {
    name: (body.name || '').trim(),
    birthday: iso,
    birthdayBad: rawBirthday !== '' && iso === null,
    phone: (body.phone || '').trim() || null,
    note: (body.note || '').trim() || null,
    gender: m.GENDERS.includes(body.gender) ? body.gender : null,
  };
}

// Sorgt dafuer, dass es fuer <gender> einen Umkleidebereich gibt. Das erste
// Geschlecht ueberhaupt bekommt einen nach ihm benannten Bereich; jedes weitere
// wird vorlaeufig dem bestehenden (geteilten) Bereich zugeordnet — der
// Jugendwart kann daraus per Einrichtungsdialog einen eigenen Bereich machen.
function ensureAreaForGender(gender) {
  const gmap = m.genderAreaMap();
  if (gmap[gender]) return gmap[gender];

  const vorhanden = m.primaryArea();
  if (!vorhanden) {
    const info = db
      .prepare('INSERT INTO areas (name, sort_order) VALUES (?, 100)')
      .run(m.DEFAULT_AREA_NAME[gender] || 'Umkleide');
    m.setGenderArea(gender, info.lastInsertRowid);
    return info.lastInsertRowid;
  }
  m.setGenderArea(gender, vorhanden.id);
  return vorhanden.id;
}

function auditFelder(row) {
  return {
    name: row.name,
    phone: row.phone,
    note: row.note,
    Geburtstag: formatGermanDate(row.birthday),
    Geschlecht: row.gender ? m.GENDER[row.gender] : '',
  };
}
const AUDIT_LABELS = { ...FIELDS, Geburtstag: 'Geburtstag', Geschlecht: 'Geschlecht' };

router.get('/mitglieder', login, (req, res) => {
  const showAll = req.query.alle === '1';
  res.render('mitglieder', {
    title: 'Mitglieder',
    members: m.members({ includeInactive: showAll }),
    showAll,
    lockers: m.allLockers(),
    genders: m.GENDERS,
  });
});

router.post('/mitglieder/neu', login, (req, res) => {
  const data = clean(req.body);
  if (!data.name) {
    req.session.flash = { type: 'warn', text: 'Ohne Namen geht es nicht.' };
    return res.redirect('/mitglieder');
  }

  // Vor dem Anlegen merken, ob dies das erste Kind eines neuen Geschlechts ist.
  const neuesGeschlecht = data.gender ? m.isNewGenderNeedingSetup(data.gender) : false;

  const info = db
    .prepare(
      'INSERT INTO members (name, birthday, phone, note, gender) VALUES (@name, @birthday, @phone, @note, @gender)'
    )
    .run(data);
  const memberId = info.lastInsertRowid;

  if (data.gender) ensureAreaForGender(data.gender);

  // Optional direkt einem freien Spint zuweisen.
  const lockerId = req.body.locker_id ? Number(req.body.locker_id) : null;
  if (lockerId) {
    const locker = m.q.lockerById.get(lockerId);
    if (locker && !locker.member_id) {
      db.prepare('UPDATE lockers SET member_id = ? WHERE id = ?').run(memberId, lockerId);
      audit.log(req, 'spint', lockerId, 'geändert', `Besitzer: - → ${data.name}`);
    }
  }

  audit.log(req, 'mitglied', memberId, 'angelegt', data.name + (data.gender ? ` (${m.GENDER[data.gender]})` : ''));

  const hinweise = [];
  if (data.birthdayBad) hinweise.push('Das Geburtsdatum war nicht lesbar (Format TT.MM.JJJJ) und wurde nicht gespeichert.');

  // Erstes Kind eines neuen Geschlechts: Jugendwart nach eigenem Bereich fragen.
  if (neuesGeschlecht && req.session.user.role === 'jugendwart') {
    req.session.flash = { type: 'ok', text: `${data.name} angelegt.` };
    return res.redirect(`/bereiche/einrichten?geschlecht=${data.gender}&mitglied=${memberId}`);
  }
  if (neuesGeschlecht) {
    hinweise.push(
      `Erstes Mitglied mit Geschlecht „${m.GENDER[data.gender]}“. Der Jugendwart kann unter „Bereiche“ festlegen, ob es dafür einen eigenen Umkleidebereich gibt.`
    );
  }

  req.session.flash = { type: hinweise.length ? 'warn' : 'ok', text: [`${data.name} angelegt.`, ...hinweise].join(' ') };
  res.redirect('/mitglieder');
});

router.post('/mitglieder/:id/bearbeiten', login, (req, res) => {
  const member = m.q.memberById.get(req.params.id);
  if (!member) return res.redirect('/mitglieder');

  const data = clean(req.body);
  if (!data.name) {
    req.session.flash = { type: 'warn', text: 'Ohne Namen geht es nicht.' };
    return res.redirect('/mitglieder');
  }

  const neuesGeschlecht =
    data.gender && data.gender !== member.gender ? m.isNewGenderNeedingSetup(data.gender) : false;

  // Ein nicht lesbares Datum lassen wir stehen, statt ein vorhandenes zu loeschen.
  const birthday = data.birthdayBad ? member.birthday : data.birthday;

  db.prepare(
    'UPDATE members SET name = @name, birthday = @birthday, phone = @phone, note = @note, gender = @gender WHERE id = @id'
  ).run({ ...data, birthday, id: member.id });

  if (data.gender) ensureAreaForGender(data.gender);

  const detail = audit.diff(AUDIT_LABELS, auditFelder(member), auditFelder({ ...data, birthday }));
  if (detail) audit.log(req, 'mitglied', member.id, 'geändert', detail);

  const hinweise = [];
  if (data.birthdayBad) hinweise.push('Das Geburtsdatum war nicht lesbar und blieb unverändert.');

  if (neuesGeschlecht && req.session.user.role === 'jugendwart') {
    req.session.flash = { type: 'ok', text: 'Gespeichert.' };
    return res.redirect(`/bereiche/einrichten?geschlecht=${data.gender}&mitglied=${member.id}`);
  }

  req.session.flash = { type: hinweise.length ? 'warn' : 'ok', text: ['Gespeichert.', ...hinweise].join(' ') };
  res.redirect('/mitglieder');
});

router.post('/mitglieder/:id/status', login, (req, res) => {
  const member = m.q.memberById.get(req.params.id);
  if (!member) return res.redirect('/mitglieder');

  const active = member.active ? 0 : 1;
  db.transaction(() => {
    db.prepare('UPDATE members SET active = ? WHERE id = ?').run(active, member.id);
    // Wer austritt, gibt den Spint frei — die Ausruestung bleibt vorerst drin.
    if (!active) db.prepare('UPDATE lockers SET member_id = NULL WHERE member_id = ?').run(member.id);
  })();

  audit.log(req, 'mitglied', member.id, active ? 'reaktiviert' : 'ausgetreten', member.name);
  req.session.flash = {
    type: 'ok',
    text: active ? `${member.name} ist wieder aktiv.` : `${member.name} als ausgetreten markiert, Spint freigegeben.`,
  };
  res.redirect('/mitglieder' + (active ? '' : '?alle=1'));
});

router.post('/mitglieder/:id/loeschen', auth.requireJugendwart, (req, res) => {
  const member = m.q.memberById.get(req.params.id);
  if (!member) return res.redirect('/mitglieder');

  db.prepare('DELETE FROM members WHERE id = ?').run(member.id);
  audit.log(req, 'mitglied', member.id, 'gelöscht', member.name);
  req.session.flash = { type: 'ok', text: `${member.name} gelöscht.` };
  res.redirect('/mitglieder?alle=1');
});

module.exports = router;
