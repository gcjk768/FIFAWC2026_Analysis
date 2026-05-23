'use strict';

const SQUADS = {
  'Argentina': {
    GK:  [{ name: 'Emiliano Martinez', club: 'Aston Villa', caps: 42 }],
    DEF: [
      { name: 'Cristian Romero',    club: 'Tottenham',  caps: 38 },
      { name: 'Nicolas Otamendi',   club: 'Benfica',    caps: 109 },
      { name: 'Lisandro Martinez',  club: 'Man Utd',    caps: 28 },
      { name: 'Nahuel Molina',      club: 'Atletico',   caps: 39 },
      { name: 'Marcos Acuna',       club: 'Sevilla',    caps: 63 },
    ],
    MID: [
      { name: 'Alexis Mac Allister', club: 'Liverpool',  caps: 35, goals: 7,  assists: 10 },
      { name: 'Enzo Fernandez',      club: 'Chelsea',    caps: 40, goals: 8,  assists: 6  },
      { name: 'Rodrigo De Paul',     club: 'Atletico',   caps: 76, goals: 6,  assists: 11 },
      { name: 'Giovani Lo Celso',    club: 'Villarreal', caps: 54, goals: 9,  assists: 8  },
    ],
    FWD: [
      { name: 'Lionel Messi',     club: 'Inter Miami', caps: 187, goals: 18, assists: 22, wcGoals: 13 },
      { name: 'Lautaro Martinez', club: 'Inter Milan',  caps: 60,  goals: 23, assists: 9,  wcGoals: 4  },
      { name: 'Julian Alvarez',   club: 'Atletico',    caps: 42,  goals: 21, assists: 8,  wcGoals: 4  },
      { name: 'Angel Di Maria',   club: 'Benfica',     caps: 145, goals: 31, assists: 33, wcGoals: 6  },
    ],
  },
  'Brazil': {
    GK:  [{ name: 'Alisson',       club: 'Liverpool', caps: 73 }],
    DEF: [
      { name: 'Marquinhos',  club: 'PSG',      caps: 87 },
      { name: 'Gabriel',     club: 'Arsenal',  caps: 29 },
      { name: 'Danilo',      club: 'Juventus', caps: 85 },
      { name: 'Alex Sandro', club: 'Juventus', caps: 44 },
    ],
    MID: [
      { name: 'Bruno Guimaraes', club: 'Newcastle', caps: 38, goals: 6, assists: 9 },
      { name: 'Lucas Paqueta',   club: 'Flamengo',  caps: 58, goals: 8, assists: 6 },
      { name: 'Casemiro',        club: 'Man Utd',   caps: 75, goals: 7, assists: 4 },
    ],
    FWD: [
      { name: 'Vinicius Junior', club: 'Real Madrid', caps: 39, goals: 19, assists: 11, wcGoals: 0 },
      { name: 'Raphinha',        club: 'Barcelona',   caps: 47, goals: 21, assists: 9,  wcGoals: 1 },
      { name: 'Rodrygo',         club: 'Real Madrid', caps: 32, goals: 14, assists: 8,  wcGoals: 2 },
      { name: 'Endrick',         club: 'Lyon',        caps: 8,  goals: 11, assists: 4,  wcGoals: 0 },
      { name: 'Neymar',          club: 'Santos',      caps: 128, goals: 79, assists: 55, wcGoals: 8 },
    ],
  },
  'France': {
    GK:  [{ name: 'Mike Maignan', club: 'AC Milan', caps: 25 }],
    DEF: [
      { name: 'William Saliba',   club: 'Arsenal',   caps: 28 },
      { name: 'Dayot Upamecano', club: 'Bayern',     caps: 38 },
      { name: 'Theo Hernandez',  club: 'AC Milan',   caps: 32 },
      { name: 'Jules Kounde',    club: 'Barcelona',  caps: 30 },
    ],
    MID: [
      { name: 'Aurelien Tchouameni', club: 'Real Madrid', caps: 35, goals: 2,  assists: 3 },
      { name: 'Eduardo Camavinga',   club: 'Real Madrid', caps: 30, goals: 3,  assists: 5 },
      { name: 'Antoine Griezmann',   club: 'Atletico',    caps: 132, goals: 12, assists: 9 },
    ],
    FWD: [
      { name: 'Kylian Mbappe',   club: 'Real Madrid', caps: 82, goals: 24, assists: 5,  wcGoals: 12 },
      { name: 'Ousmane Dembele', club: 'PSG',         caps: 61, goals: 14, assists: 13, wcGoals: 1  },
      { name: 'Marcus Thuram',   club: 'Inter Milan',  caps: 38, goals: 18, assists: 7,  wcGoals: 1  },
    ],
  },
  'England': {
    GK:  [{ name: 'Jordan Pickford', club: 'Everton', caps: 66 }],
    DEF: [
      { name: 'Kyle Walker',  club: 'Man City',      caps: 89 },
      { name: 'Marc Guehi',   club: 'Crystal Palace', caps: 24 },
      { name: 'John Stones',  club: 'Man City',      caps: 78 },
      { name: 'Luke Shaw',    club: 'Man Utd',       caps: 38 },
    ],
    MID: [
      { name: 'Declan Rice',            club: 'Arsenal',     caps: 58, goals: 7,  assists: 9  },
      { name: 'Jude Bellingham',        club: 'Real Madrid', caps: 48, goals: 13, assists: 10 },
      { name: 'Trent Alexander-Arnold', club: 'Real Madrid', caps: 45, goals: 5,  assists: 12 },
    ],
    FWD: [
      { name: 'Harry Kane',      club: 'Bayern Munich', caps: 102, goals: 27, assists: 9,  wcGoals: 6 },
      { name: 'Bukayo Saka',     club: 'Arsenal',       caps: 51,  goals: 18, assists: 14, wcGoals: 2 },
      { name: 'Marcus Rashford', club: 'Man Utd',       caps: 58,  goals: 17, assists: 8,  wcGoals: 3 },
    ],
  },
  'Germany': {
    GK:  [{ name: 'Manuel Neuer', club: 'Bayern Munich', caps: 120 }],
    DEF: [
      { name: 'Antonio Rudiger',    club: 'Real Madrid', caps: 78 },
      { name: 'Nico Schlotterbeck', club: 'Dortmund',    caps: 24 },
      { name: 'David Raum',         club: 'RB Leipzig',  caps: 28 },
    ],
    MID: [
      { name: 'Joshua Kimmich', club: 'Bayern Munich', caps: 88, goals: 3,  assists: 11 },
      { name: 'Jamal Musiala',  club: 'Bayern Munich', caps: 42, goals: 10, assists: 6  },
      { name: 'Florian Wirtz',  club: 'Liverpool',     caps: 32, goals: 14, assists: 11 },
      { name: 'Kai Havertz',    club: 'Arsenal',       caps: 55, goals: 16, assists: 7  },
    ],
    FWD: [
      { name: 'Leroy Sane',   club: 'Bayern Munich', caps: 58, goals: 12, assists: 9  },
      { name: 'Serge Gnabry', club: 'Bayern Munich', caps: 44, goals: 21, assists: 10 },
    ],
  },
  'Spain': {
    GK:  [{ name: 'Unai Simon', club: 'Athletic Club', caps: 35 }],
    DEF: [
      { name: 'Dani Carvajal',    club: 'Real Madrid', caps: 48 },
      { name: 'Aymeric Laporte',  club: 'Al-Nassr',    caps: 38 },
      { name: 'Robin Le Normand', club: 'Atletico',    caps: 18 },
      { name: 'Alejandro Balde',  club: 'Barcelona',   caps: 20 },
    ],
    MID: [
      { name: 'Rodri',       club: 'Man City',  caps: 58, goals: 3,  assists: 5  },
      { name: 'Pedri',       club: 'Barcelona', caps: 38, goals: 8,  assists: 12 },
      { name: 'Fabian Ruiz', club: 'PSG',       caps: 38, goals: 5,  assists: 8  },
      { name: 'Dani Olmo',   club: 'Barcelona', caps: 42, goals: 11, assists: 7  },
    ],
    FWD: [
      { name: 'Lamine Yamal',  club: 'Barcelona', caps: 22, goals: 16, assists: 11, wcGoals: 0 },
      { name: 'Ferran Torres', club: 'Barcelona', caps: 55, goals: 10, assists: 6,  wcGoals: 3 },
      { name: 'Alvaro Morata', club: 'AC Milan',  caps: 78, goals: 35, assists: 18, wcGoals: 5 },
    ],
  },
  'Portugal': {
    GK:  [{ name: 'Diogo Costa', club: 'Porto', caps: 22 }],
    DEF: [
      { name: 'Ruben Dias',  club: 'Man City', caps: 68 },
      { name: 'Pepe',        club: 'Porto',    caps: 141 },
      { name: 'Nuno Mendes', club: 'PSG',      caps: 32 },
    ],
    MID: [
      { name: 'Bruno Fernandes', club: 'Man Utd',  caps: 78, goals: 14, assists: 16 },
      { name: 'Bernardo Silva',  club: 'Man City',  caps: 78, goals: 10, assists: 12 },
      { name: 'Vitinha',         club: 'PSG',       caps: 38, goals: 5,  assists: 8  },
      { name: 'Joao Felix',      club: 'Chelsea',   caps: 50, goals: 12, assists: 7  },
    ],
    FWD: [
      { name: 'Cristiano Ronaldo', club: 'Al-Nassr', caps: 216, goals: 31, assists: 9,  wcGoals: 9 },
      { name: 'Rafael Leao',       club: 'AC Milan',  caps: 38,  goals: 17, assists: 11, wcGoals: 0 },
    ],
  },
  'Morocco': {
    GK:  [{ name: 'Yassine Bounou', club: 'Al-Hilal', caps: 48 }],
    DEF: [
      { name: 'Achraf Hakimi',    club: 'PSG',           caps: 68, goals: 5,  assists: 14 },
      { name: 'Nayef Aguerd',     club: 'Real Sociedad', caps: 42 },
      { name: 'Romain Saiss',     club: 'Besiktas',      caps: 78 },
      { name: 'Noussair Mazraoui', club: 'Man Utd',      caps: 52 },
    ],
    MID: [
      { name: 'Sofyan Amrabat',  club: 'Fiorentina', caps: 55, goals: 2, assists: 3 },
      { name: 'Azzedine Ounahi', club: 'Marseille',  caps: 32, goals: 4, assists: 5 },
    ],
    FWD: [
      { name: 'Hakim Ziyech',      club: 'Galatasaray', caps: 62, goals: 13, assists: 9 },
      { name: 'Youssef En-Nesyri', club: 'Fenerbahce',  caps: 48, goals: 18, assists: 5 },
      { name: 'Soufiane Rahimi',   club: 'Al-Ain',      caps: 28, goals: 10, assists: 6 },
    ],
  },
  'Japan': {
    GK:  [{ name: 'Shuichi Gonda', club: 'Shimizu S-Pulse', caps: 58 }],
    DEF: [
      { name: 'Hiroki Sakai', club: 'Urawa Reds', caps: 68 },
      { name: 'Maya Yoshida', club: 'FC Machida',  caps: 128 },
      { name: 'Ko Itakura',   club: 'Dortmund',   caps: 28 },
    ],
    MID: [
      { name: 'Wataru Endo',   club: 'Liverpool', caps: 58, goals: 3,  assists: 5 },
      { name: 'Daichi Kamada', club: 'Lazio',     caps: 52, goals: 10, assists: 7 },
      { name: 'Ritsu Doan',    club: 'Freiburg',  caps: 55, goals: 9,  assists: 6 },
    ],
    FWD: [
      { name: 'Takefusa Kubo',   club: 'Real Sociedad', caps: 38, goals: 12, assists: 9 },
      { name: 'Kaoru Mitoma',    club: 'Brighton',      caps: 42, goals: 11, assists: 8 },
      { name: 'Takumi Minamino', club: 'Monaco',        caps: 68, goals: 14, assists: 6 },
    ],
  },
  'USA': {
    GK:  [{ name: 'Matt Turner', club: 'Nottm Forest', caps: 38 }],
    DEF: [
      { name: 'Sergino Dest',   club: 'PSV',         caps: 38 },
      { name: 'Miles Robinson', club: 'Atlanta Utd',  caps: 28 },
      { name: 'Tim Ream',       club: 'Charlotte FC', caps: 58 },
    ],
    MID: [
      { name: 'Tyler Adams',     club: 'Bournemouth', caps: 48, goals: 2, assists: 4  },
      { name: 'Weston McKennie', club: 'Juventus',    caps: 48, goals: 6, assists: 5  },
      { name: 'Gio Reyna',       club: 'Dortmund',    caps: 32, goals: 8, assists: 10 },
    ],
    FWD: [
      { name: 'Christian Pulisic', club: 'AC Milan', caps: 68, goals: 14, assists: 9 },
      { name: 'Ricardo Pepi',      club: 'PSV',      caps: 32, goals: 19, assists: 7 },
      { name: 'Tim Weah',          club: 'Juventus', caps: 38, goals: 8,  assists: 5 },
    ],
  },
  'Mexico': {
    GK:  [{ name: 'Guillermo Ochoa', club: 'Salernitana', caps: 140 }],
    DEF: [
      { name: 'Cesar Montes',     club: 'Espanyol',    caps: 48 },
      { name: 'Johan Vasquez',    club: 'Genoa',       caps: 28 },
      { name: 'Gerardo Arteaga',  club: 'Getafe',      caps: 32 },
    ],
    MID: [
      { name: 'Edson Alvarez',    club: 'West Ham',    caps: 78, goals: 4, assists: 5 },
      { name: 'Andres Guardado',  club: 'Club America', caps: 178, goals: 27, assists: 15 },
      { name: 'Hirving Lozano',   club: 'PSV',         caps: 68, goals: 18, assists: 12 },
    ],
    FWD: [
      { name: 'Henry Martin',   club: 'Club America', caps: 42, goals: 16, assists: 7 },
      { name: 'Santiago Gimenez', club: 'Feyenoord',  caps: 28, goals: 21, assists: 6 },
    ],
  },
  'Canada': {
    GK:  [{ name: 'Maxime Crepeau', club: 'LA Galaxy', caps: 38 }],
    DEF: [
      { name: 'Kamal Miller',   club: 'Portland',   caps: 38 },
      { name: 'Steven Vitoria', club: 'Sporting CP', caps: 42 },
    ],
    MID: [
      { name: 'Atiba Hutchinson', club: 'Besiktas',   caps: 105, goals: 12, assists: 8 },
      { name: 'Stephen Eustaquio', club: 'Porto',     caps: 38,  goals: 6,  assists: 9 },
    ],
    FWD: [
      { name: 'Alphonso Davies', club: 'Bayern Munich', caps: 52, goals: 14, assists: 16 },
      { name: 'Jonathan David',  club: 'Lille',         caps: 42, goals: 26, assists: 8  },
      { name: 'Tajon Buchanan',  club: 'Inter Milan',   caps: 38, goals: 9,  assists: 11 },
    ],
  },
  'South Korea': {
    GK:  [{ name: 'Kim Seung-gyu', club: 'Vissel Kobe', caps: 58 }],
    DEF: [
      { name: 'Kim Min-jae', club: 'Bayern Munich', caps: 58 },
      { name: 'Kim Jin-su',  club: 'Jeonbuk FC',    caps: 62 },
    ],
    MID: [
      { name: 'Lee Jae-sung', club: 'Mainz',        caps: 68, goals: 12, assists: 9 },
      { name: 'Hwang In-beom', club: 'Club Brugge', caps: 52, goals: 8,  assists: 7 },
    ],
    FWD: [
      { name: 'Son Heung-min', club: 'Tottenham', caps: 118, goals: 35, assists: 18, wcGoals: 4 },
      { name: 'Hwang Hee-chan', club: 'Wolves',   caps: 58,  goals: 14, assists: 7  },
    ],
  },
  'Australia': {
    GK:  [{ name: 'Mathew Ryan', club: 'AZ Alkmaar', caps: 82 }],
    DEF: [{ name: 'Harry Souttar', club: 'Leicester', caps: 28 }],
    MID: [
      { name: 'Aaron Mooy',   club: 'Celtic',    caps: 62, goals: 8, assists: 10 },
      { name: 'Jackson Irvine', club: 'St Pauli', caps: 58, goals: 14, assists: 9 },
    ],
    FWD: [
      { name: 'Mitchell Duke',   club: 'FC Macarthur', caps: 38, goals: 12, assists: 4 },
      { name: 'Martin Boyle',    club: 'Al-Faisaly',   caps: 32, goals: 10, assists: 7 },
    ],
  },
  'Netherlands': {
    GK:  [{ name: 'Bart Verbruggen', club: 'Brighton', caps: 18 }],
    DEF: [
      { name: 'Virgil van Dijk',  club: 'Liverpool',   caps: 68 },
      { name: 'Denzel Dumfries',  club: 'Inter Milan',  caps: 48 },
      { name: 'Nathan Ake',       club: 'Man City',    caps: 38 },
    ],
    MID: [
      { name: 'Frenkie de Jong', club: 'Barcelona', caps: 58, goals: 5, assists: 8 },
      { name: 'Tijjani Reijnders', club: 'AC Milan', caps: 28, goals: 8, assists: 6 },
    ],
    FWD: [
      { name: 'Cody Gakpo',   club: 'Liverpool', caps: 42, goals: 18, assists: 9, wcGoals: 3 },
      { name: 'Donyell Malen', club: 'Dortmund', caps: 38, goals: 14, assists: 8 },
    ],
  },
  'Belgium': {
    GK:  [{ name: 'Koen Casteels', club: 'Al-Qadsiah', caps: 22 }],
    DEF: [
      { name: 'Wout Faes',      club: 'Leicester',  caps: 28 },
      { name: 'Arthur Theate',  club: 'Rennes',     caps: 18 },
    ],
    MID: [
      { name: 'Kevin De Bruyne', club: 'Man City',  caps: 102, goals: 26, assists: 43 },
      { name: 'Youri Tielemans', club: 'Aston Villa', caps: 62, goals: 10, assists: 8 },
    ],
    FWD: [
      { name: 'Romelu Lukaku', club: 'Napoli',     caps: 108, goals: 70, assists: 24, wcGoals: 6 },
      { name: 'Leandro Trossard', club: 'Arsenal', caps: 32,  goals: 12, assists: 8  },
    ],
  },
};

/**
 * Find a squad entry by fuzzy team name match.
 * @param {string} name
 * @returns {[string, object]|null}
 */
function findSquad(name) {
  if (!name) return null;
  const lower = name.toLowerCase();
  const entry = Object.entries(SQUADS).find(([t]) =>
    t.toLowerCase().includes(lower) || lower.includes(t.toLowerCase().split(' ')[0]),
  );
  return entry || null;
}

module.exports = { SQUADS, findSquad };
