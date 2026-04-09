// Generate realistic Brazilian customer data

const FIRST_NAMES = [
  "Lucas", "Gabriel", "Rafael", "Matheus", "Pedro", "Gustavo", "Felipe", "Bruno",
  "Ana", "Juliana", "Fernanda", "Camila", "Larissa", "Beatriz", "Mariana", "Carolina",
  "Thiago", "Leonardo", "Diego", "Rodrigo", "Amanda", "Isabela", "Natália", "Letícia",
  "João", "André", "Carlos", "Daniel", "Eduardo", "Henrique", "Bianca", "Gabriela",
];

const LAST_NAMES = [
  "Silva", "Santos", "Oliveira", "Souza", "Pereira", "Costa", "Ferreira", "Rodrigues",
  "Almeida", "Nascimento", "Lima", "Araújo", "Fernandes", "Carvalho", "Gomes", "Martins",
  "Rocha", "Ribeiro", "Alves", "Monteiro", "Mendes", "Barros", "Freitas", "Barbosa",
  "Pinto", "Moura", "Cavalcanti", "Dias", "Castro", "Campos", "Cardoso", "Correia",
];

const DOMAINS = ["gmail.com", "hotmail.com", "outlook.com", "yahoo.com.br", "icloud.com"];

const DDD = ["11", "21", "31", "41", "51", "61", "71", "81", "85", "19", "27", "48", "47", "62", "92"];

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomDigits(n: number): string {
  return Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");
}

function generateCPF(): string {
  const n = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));

  // First check digit
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += n[i] * (10 - i);
  let d1 = 11 - (sum % 11);
  if (d1 >= 10) d1 = 0;
  n.push(d1);

  // Second check digit
  sum = 0;
  for (let i = 0; i < 10; i++) sum += n[i] * (11 - i);
  let d2 = 11 - (sum % 11);
  if (d2 >= 10) d2 = 0;
  n.push(d2);

  const cpf = n.join("");
  return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
}

function removeAccents(str: string): string {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export interface FakeCustomer {
  name: string;
  email: string;
  phone: string;
  document: string;
}

export function generateFakeCustomer(): FakeCustomer {
  const firstName = randomItem(FIRST_NAMES);
  const lastName = randomItem(LAST_NAMES);
  const name = `${firstName} ${lastName}`;

  const emailBase = removeAccents(`${firstName.toLowerCase()}.${lastName.toLowerCase()}`);
  const email = `${emailBase}${randomDigits(2)}@${randomItem(DOMAINS)}`;

  const phone = `${randomItem(DDD)}9${randomDigits(8)}`;

  const document = generateCPF();

  return { name, email, phone, document };
}
