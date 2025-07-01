import { client } from "@/sanity/lib/client";

export async function getProjects1() {
  const data = await client.fetch(`
       *[_type == "project"] | order(completedDate desc)
       `);
  return data;
}

export async function getProjects() {
  const data = await client.fetch(`
      *[_type == "project"] | order(completedDate desc){
      year,
      name,
      testimony,
      description,
        githubLink,
        visitLink,
        work,
        tech,
      images[] {
    _key,
    asset-> {
      _id,
      url,
      metadata {
        dimensions {
          width,
          height,
          aspectRatio
        },
        lqip,
        blurHash
      }
    },
    alt
  }

  }
       `);
  return data;
}