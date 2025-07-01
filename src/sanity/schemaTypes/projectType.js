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
          { title: 'Development', value: 'development' },
          { title: 'Design', value: 'design' },
          { title: 'Frontend', value: 'frontend' },
          { title: 'Backend', value: 'backend' },
          { title: 'Full Stack', value: 'fullstack' },
          { title: 'UI/UX', value: 'uiux' }
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
          { title: 'React', value: 'react' },
          { title: 'Next.js', value: 'nextjs' },
          { title: 'JavaScript', value: 'javascript' },
          { title: 'TypeScript', value: 'typescript' },
          { title: 'Node.js', value: 'nodejs' },
          { title: 'Python', value: 'python' },
          { title: 'CSS', value: 'css' },
          { title: 'Tailwind CSS', value: 'tailwindcss' },
          { title: 'Sanity', value: 'sanity' },
          { title: 'MongoDB', value: 'mongodb' },
          { title: 'PostgreSQL', value: 'postgresql' }
        ]
      }
    }),
    defineField({
      name: 'services',
      title: 'Services Provided',
      type: 'array',
      of: [{ type: 'string' }],
      options: {
        list: [
          { title: 'Web Development', value: 'web-development' },
          { title: 'Mobile Development', value: 'mobile-development' },
          { title: 'UI/UX Design', value: 'ui-ux-design' },
          { title: 'Consulting', value: 'consulting' },
          { title: 'Maintenance', value: 'maintenance' },
          { title: 'API Development', value: 'api-development' }
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