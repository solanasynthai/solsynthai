name: Feature Request
description: Suggest an idea for this project
title: "[FEATURE] "
labels: ["enhancement"]
body:
  - type: markdown
    attributes:
      value: |
        Thanks for taking the time to suggest a new feature!
  - type: textarea
    id: description
    attributes:
      label: Feature Description
      placeholder: A clear and concise description of what you want to happen.
    validations:
      required: true
