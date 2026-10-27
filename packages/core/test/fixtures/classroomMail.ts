// Classroom notification emails as Gmail hands them to the Worker: the From
// and Subject headers, Gmail's snippet, and the text the Worker takes from the
// body (bodyText). Written to the layout of Classroom's English emails; the
// names, ids and dates are made up. The links carry ids the way Classroom's
// do, as the base64 of the API's decimal id.

export interface Fixture {
  from: string
  subject: string
  snippet: string
  text: string
  html?: string
}

const FOOTER = `Google LLC, 1600 Amphitheatre Parkway, Mountain View, CA 94043 USA

This email was sent to you because you indicated that you'd like to receive email notifications from Google Classroom. If you don't want to receive emails from Classroom, you can unsubscribe.`

/** Course 647094615095, coursework 647096345993. */
export const assignment: Fixture = {
  from: '"Prof. Anita Rao (Classroom)" <no-reply@classroom.google.com>',
  subject: 'New assignment: "DBMS Lab 4: Normalisation"',
  snippet: 'Prof. Anita Rao posted a new assignment in CS301 DBMS New assignment Due Oct 22, 11:59 PM DBMS Lab 4: Normalisation',
  text: `Prof. Anita Rao posted a new assignment in CS301 DBMS

New assignment
Due Oct 22, 11:59 PM
DBMS Lab 4: Normalisation
Normalise the schema from lab 3 to BCNF and upload the ER diagram.

Open <https://classroom.google.com/c/NjQ3MDk0NjE1MDk1/a/NjQ3MDk2MzQ1OTkz/details>

${FOOTER}`,
}

/** No time on the due line: due on the day. */
export const quiz: Fixture = {
  from: '"Dr. S. Iyer (Classroom)" <no-reply@classroom.google.com>',
  subject: 'New quiz assignment: "Unit 2 quiz"',
  snippet: 'Dr. S. Iyer posted a new quiz assignment in CS302 Computer Networks',
  text: `Dr. S. Iyer posted a new quiz assignment in CS302 Computer Networks

New quiz assignment
Due Oct 24
Unit 2 quiz
Routing and subnetting. 20 minutes, one attempt.

Open

${FOOTER}`,
  // The plain part had no link; the HTML part has it, inside Google's redirect.
  html: '<table><tr><td><a href="https://www.google.com/url?q=https%3A%2F%2Fclassroom.google.com%2Fc%2FNjQ3MTAyMzQ1Njc4%2Fa%2FNjQ3MTA1NTU1NTU1%2Fdetails&amp;sa=D">Open</a></td></tr></table>',
}

export const question: Fixture = {
  from: '"Prof. Anita Rao (Classroom)" <no-reply@classroom.google.com>',
  subject: 'New question: "Which normal form removes transitive dependencies?"',
  snippet: 'Prof. Anita Rao posted a new question in CS301 DBMS',
  text: `Prof. Anita Rao posted a new question in CS301 DBMS

New question
Due tomorrow, 9:00 AM
Which normal form removes transitive dependencies?

Open <https://classroom.google.com/u/1/c/NjQ3MDk0NjE1MDk1/sa/NjQ3MTIzNDU2Nzg5/details>

${FOOTER}`,
}

export const announcement: Fixture = {
  from: '"Dr. S. Iyer (Classroom)" <no-reply@classroom.google.com>',
  subject: 'New announcement: "Quiz moved to Thursday"',
  snippet: 'Dr. S. Iyer posted a new announcement in CS302 Computer Networks Quiz moved to Thursday',
  text: `Dr. S. Iyer posted a new announcement in CS302 Computer Networks

Quiz moved to Thursday. Same room, same time.

Open <https://classroom.google.com/c/NjQ3MTAyMzQ1Njc4/p/NjQ3MTMzMzMzMzMz>

${FOOTER}`,
}

/** An announcement with no title in the subject and no link anywhere. */
export const bareAnnouncement: Fixture = {
  from: '"Lab Assistant (Classroom)" <no-reply@classroom.google.com>',
  subject: 'New announcement',
  snippet: 'Lab Assistant posted a new announcement in Physics Lab',
  text: `Lab Assistant posted a new announcement in Physics Lab

Bring your lab coats on Monday.

${FOOTER}`,
}

export const material: Fixture = {
  from: '"Prof. Anita Rao (Classroom)" <no-reply@classroom.google.com>',
  subject: 'New material: "Week 3 slides"',
  snippet: 'Prof. Anita Rao posted new material in CS301 DBMS',
  text: `Prof. Anita Rao posted new material in CS301 DBMS

Week 3 slides

Open <https://classroom.google.com/c/NjQ3MDk0NjE1MDk1/m/NjQ3MTQ0NDQ0NDQ0/details>

${FOOTER}`,
}

/** A grade, not a post: left alone. */
export const returned: Fixture = {
  from: '"Prof. Anita Rao (Classroom)" <no-reply@classroom.google.com>',
  subject: 'Returned: "DBMS Lab 3"',
  snippet: 'Prof. Anita Rao returned your work in CS301 DBMS',
  text: `Prof. Anita Rao returned your work in CS301 DBMS

DBMS Lab 3
18/20

${FOOTER}`,
}

/** Not from Classroom, though it talks like it. */
export const lookalike: Fixture = {
  from: 'Placement Cell <placements@college.edu>',
  subject: 'New assignment: "Aptitude practice"',
  snippet: 'posted a new assignment in Placements',
  text: 'The cell posted a new assignment in Placements\nDue Oct 22\n',
}
