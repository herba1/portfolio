import { defineField, defineType } from "sanity";

export const projectType = defineType({
  name: 'project',
  title: 'Project',
  type: 'document',
  fields: [
    defineField({
      name: 'name',
      title: 'Name',
      type: 'string',
      validation: Rule => Rule.required()
    }),
    defineField({
      name: 'year',
      title: 'Year',
      type: 'string',
      validation: Rule => Rule.required()
    }),
    defineField({
      name: 'completedDate',
      title: 'Completion Date',
      type: 'date',
      validation: Rule => Rule.required(),
      description: 'When was this project completed? Used for ordering newest first.'
    }),
    defineField({
      name: 'work',
      title: 'Work Type',
      type: 'array',
      of: [{ type: 'string' }],
      options: {
        list: [
          { title: 'Development', value: 'Development' },
          { title: 'Design', value: 'Design' },
          { title: 'Frontend', value: 'Frontend' },
          { title: 'Backend', value: 'Backend' },
          { title: 'Full Stack', value: 'Fullstack' },
          { title: 'UI/UX', value: 'UI/UX' }
        ]
      }
    }),
    defineField({
      name: 'description',
      title: 'Description',
      type: 'array',
      of: [
        {
          type: 'block',
          styles: [
            { title: 'Normal', value: 'normal' },
            { title: 'H1', value: 'h1' },
            { title: 'H2', value: 'h2' },
            { title: 'H3', value: 'h3' },
            { title: 'Quote', value: 'blockquote' }
          ],
          marks: {
            decorators: [
              { title: 'Strong', value: 'strong' },
              { title: 'Emphasis', value: 'em' },
              { title: 'Code', value: 'code' }
            ],
            annotations: [
              {
                title: 'URL',
                name: 'link',
                type: 'object',
                fields: [
                  {
                    title: 'URL',
                    name: 'href',
                    type: 'url'
                  }
                ]
              }
            ]
          }
        }
      ]
    }),
    defineField({
      name: 'githubLink',
      title: 'GitHub Link',
      type: 'url'
    }),
    defineField({
      name: 'visitLink',
      title: 'Visit Site Link',
      type: 'url'
    }),
    defineField({
      name: 'tech',
      title: 'Technologies',
      type: 'array',
      of: [{ type: 'string' }],
      options: {
        list: [
          { title: 'React', value: 'React.js' },
          { title: 'Next.js', value: 'Next.js' },
          { title: 'JavaScript', value: 'JavaScript' },
          { title: 'TypeScript', value: 'TypeScript' },
          { title: 'Node.js', value: 'Node.js' },
          { title: 'Python', value: 'Python' },
          { title: 'CSS', value: 'CSS' },
          { title: 'Tailwind CSS', value: 'Tailwind CSS' },
          { title: 'Sanity', value: 'Sanity' },
          { title: 'MongoDB', value: 'MongoDB' },
          { title: 'PostgreSQL', value: 'PostgreSQL' },
          { title: 'Figma', value: 'Figma' },
          { title: 'Google Gemini API', value: 'Google Gemini API' },
          { title: 'Supabase', value: 'Supabase' },
          { title: 'N/A', value: 'N/A' }
        ]
      }
    }),
    defineField({
      name: 'testimony',
      title: 'Client Testimony',
      type: 'text'
    }),
    defineField({
      name: 'images',
      title: 'Project Images',
      type: 'array',
      of: [
        {
          type: 'image',
          options: {
            hotspot: true
          },
          fields: [
            {
              name: 'alt',
              type: 'string',
              title: 'Alternative Text'
            }
          ]
        }
      ]
    })
  ]
})