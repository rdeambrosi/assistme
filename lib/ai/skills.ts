// Lee el contenido de los .md de skills/ referenciados por `skills.file_path`
// en la base. Separado de lib/db/client.ts porque esto toca el filesystem,
// no Supabase.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Skill } from '@/lib/db/types';

export async function readSkillContent(skill: Skill): Promise<string> {
  // file_path en la base viene como 'skills/tono/belo.md'; se acota el join
  // a la carpeta skills/ (en vez de un join dinamico sobre process.cwd())
  // para que el bundler trace solo esa subcarpeta y no todo el repo.
  const relative = skill.file_path.replace(/^skills\//, '');
  const fullPath = path.join(process.cwd(), 'skills', relative);
  return readFile(fullPath, 'utf-8');
}
