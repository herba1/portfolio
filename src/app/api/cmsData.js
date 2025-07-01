import { client } from "@/sanity/lib/client";

export async function getProjects() {
  const data = await client.fetch(`
       *[_type == "project"] | order(completedDate desc)
       `);
  return data;
}
