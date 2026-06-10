<template>
    <v-card>
    <v-card-title>
     {{ $t('menu_auto_matches') }}
      <v-spacer />
    </v-card-title>
    <v-card-title>
      <v-text-field
        v-model="search"
        append-icon="mdi-magnify"
        :label="$t('search')"
        single-line
        hide-details
      ></v-text-field>
    </v-card-title>
    <v-data-table
      style="cursor: pointer"
      :headers="headers"
      :items="automatches"
      :options.sync="options"
      :footer-props="{ 
      'items-per-page-options': [5,10,20,50] ,
      'items-per-page-text':this.$t('row_per_page')}"
      :no-data-text="$t('no_data')"
      :loading="loading"
      class="elevation-1"
      :search="search"
      @click:row="clickIt"
    >
      <template v-slot:item.uid="{ item }">
        <router-link :to="'/resolve/'+item.id+'?flagType='+item.reasonCode">{{ item.uid }}</router-link>
      </template>
      <template v-slot:item.reason="{ item }">
        <span class="text-uppercase">{{ item.reason }}</span>
      </template>
      <template v-slot:item.source="{ item }">
        <span class="text-uppercase">{{ getClientDisplayName(item.source) }}</span>
      </template>
      <template v-slot:item.date="{ item }">
        {{ item.date | moment("MMMM DD YYYY HH:mm:ssZ") }}
      </template>
      <template v-slot:item.score="{ item }">
        <v-chip
          v-if="item.score !== undefined"
          :color="listScoreColor(item)"
          dark
          small
        >
          {{ formatListScore(item) }}
        </v-chip>
        <span v-else>—</span>
      </template>
      <template v-slot:item.threshold="{ item }">
        <span v-if="item.threshold !== undefined">{{ item.threshold }}</span>
        <span v-else>—</span>
      </template>
      <template v-slot:item.matchType="{ item }">
        <v-chip
          v-if="item.matchType"
          :color="listScoreColor(item)"
          dark
          small
        >
          {{ $t('match_type_' + item.matchType) }}
        </v-chip>
        <span v-else>—</span>
      </template>
    </v-data-table>
  </v-card>
</template>

<script>
// @ is an alias to /src
import axios from "axios";
import { generalMixin } from "@/mixins/generalMixin";
export default {
  mixins: [generalMixin],
  name: "Automatch",
  components: {
  },
  data() {
    return {
      automatches: [],
      debug: "",
      search: "",
      loading: false,
      prevPage: -1,
      link: [],
      options: { itemsPerPage: 10, sortBy: ["family"] },
      rowsPerPageItems: [5, 10, 20, 50],
      headers: [
        { text:  this.$t('cr_id'), value: "uid" },
        { text:  this.$t('surname'), value: "family" },
        { text:  this.$t('given_names'), value: "given" },
        { text:  this.$t('source'), value: "source" },
        { text:  this.$t('source_id') , value: "source_id" },
        { text:  this.$t('reason'), value: "reason" },
        { text:  this.$t('match_score'), value: "score" },
        { text:  this.$t('match_threshold'), value: "threshold" },
        { text:  this.$t('date_flagged'), value: "date" },
        { text:  "Type", value: "matchType", sortable: false }
      ],
    };
  },
  methods: {
    formatListScore(item) {
      if (item.score === undefined) {
        return '—'
      }
      if (item.threshold !== undefined) {
        return `${item.score} / ${item.threshold}`
      }
      return `${item.score}`
    },
    listScoreColor(item) {
      if (item.matchType === 'auto') {
        return 'green'
      }
      if (item.matchType === 'potential') {
        return 'amber'
      }
      if (item.matchType === 'conflict') {
        return 'red'
      }
      return 'grey'
    },
    getAutomatches() {
      this.loading = true
      axios.get('/ocrux/match/get-new-auto-matches').then((resp) => {
        this.automatches = resp.data
        this.loading = false
      })
    },
    clickIt: function(client) {
      this.$router.push({ name: "automatch", params: { clientId: client.uid } });
    }
  },
  created() {
    this.getAutomatches()
  }
};
</script>
