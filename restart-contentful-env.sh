#!/bin/bash

# Step 1: Sanitize the environment
env -i bash

# Step 2: Delete the development environment (replace with your actual commands)
# potential environment ids: master, development, topic-page-link-base, base-do-not-delete
contentful space environment delete --space-id vxz8iidw3zqd --environment-id development
# Step 3: Clone the master environment (replace with your actual commands)
contentful space environment create --name development --space-id vxz8iidw3zqd --source-environment-id topic-page-link-base --environment-id development
