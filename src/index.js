const execa = require("execa");
const Listr = require("listr");

const testConfig = require("./setup/test-config");
const cleanDist = require("./setup/clean-dist");
const downloadCategories = require("./wordpress/category-download");
const downloadUsers = require("./wordpress/user-download");
const downloadPosts = require("./wordpress/post-download");
const transformPosts = require("./wordpress/post-transform");
const createAssetList = require("./wordpress/create-asset-list");
const createClient = require("./contentful/create-client");
const uploadAssets = require("./contentful/upload-assets");
const matchAuthorTypes = require("./contentful/match-author-types");
const createBlogPosts = require("./contentful/create-blog-posts");
const createAuthors = require("./contentful/create-authors");
const createRelatedLinks = require("./contentful/create-related-links");
const createRelatedTopics = require("./contentful/create-related-topics");
const createTopicPates = require("./contentful/create-topic-pages");
const deleteEntries = require("./contentful/delete-entries");
const createPostReferences = require("./contentful/create-post-references");
const updateBreadcrumbs = require("./contentful/update-breadcrumbs");

const tasks = new Listr([
  // {
  //   title: "Setup & Pre-flight checks",
  //   task: () => {
  //     return new Listr([
  //       {
  //         title: "Check env config",
  //         task: () => testConfig(),
  //       },
  //       {
  //         title: "Clean destination folder",
  //         task: () => cleanDist(),
  //       },
  //     ]);
  //   },
  // },
  // {
  //   title: "WordPress export: Users",
  //   task: () => {
  //     return new Listr([
  //       {
  //         title: "Download raw JSON",
  //         task: () => downloadUsers(),
  //       },
  //     ]);
  //   },
  // },
  // {
  //   title: "WordPress export: Categories",
  //   task: () => {
  //     return new Listr([
  //       {
  //         title: "Download raw JSON",
  //         task: () => downloadCategories(),
  //       },
  //     ]);
  //   },
  // },
  // {
  //   title: "WordPress export: Posts",
  //   task: () => {
  //     return new Listr([
  //       {
  //         title: "Download raw JSON",
  //         task: () => downloadPosts(),
  //       },
  //       {
  //         title: "Transform into Contentful format",
  //         task: () => transformPosts(),
  //       },
  //       {
  //         title: "Create list of assets",
  //         task: () => createAssetList(),
  //       },
  //     ]);
  //   },
  // },
  {
    title: "Contentful import",
    task: () => {
      return new Listr([
        // {
        //   title: "Create Content Management API Client",
        //   task: () => createClient(),
        // },
        // {
        //   title: "Delete existing entries",
        //   task: () => createClient().then(deleteEntries),
        // },
        // {
        //   title: "Upload Assets",
        //   task: () => createClient().then(uploadAssets),
        // },
        // {
        //   title: "Create Topic Links",
        //   task: () => createClient().then(createRelatedLinks),
        // },
        // {
        //   title: "Create Related Links",
        //   task: () => createClient().then(createRelatedTopics),
        // },
        // {
        //   title: "Create Authors",
        //   task: () => createClient().then(createAuthors),
        // },
        // {
        //   title: "Create Post References",
        //   task: () => createClient().then(createPostReferences),
        // },
        // {
        //   title: "Match WP 'User' to Contentful 'Person'",
        //   task: () => createClient().then(matchAuthorTypes),
        // },
        // {
        //   title: "Create Posts",
        //   task: () => createClient().then(createBlogPosts),
        // },
        {
          title: "Update Breadcrumbs",
          task: () => createClient().then(updateBreadcrumbs)
        }
      ]);
    },
  },
]);

tasks.run().catch((err) => console.error(err));
